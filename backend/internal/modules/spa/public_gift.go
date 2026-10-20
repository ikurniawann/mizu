package spa

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
)

// Gift vouchers bought online (revisi bot WhatsApp): the guest picks the
// outlet and nominal, pays a Xendit invoice, and the paid callback issues a
// gift card valid at that outlet; TopicGiftOrderPaid lets the bot send the
// code. Cards are the existing gift cards, redeemed at the POS.

// spaGiftPrefix is the Xendit external_id prefix of gift voucher invoices.
const spaGiftPrefix = "spa-gv-"

// TopicGiftOrderPaid carries a GiftOrder once its card is issued.
const TopicGiftOrderPaid = "spa.gift_order.paid"

// Gift order statuses.
const (
	GiftPending = "pending"
	GiftPaid    = "paid"
	GiftExpired = "expired"
)

// GiftConfig is the gift card configuration a purchase is checked against.
type GiftConfig struct {
	Presets      []float64
	AllowCustom  bool
	ExpiryMonths *int
	// Rejection explains an invalid nominal ("Nominal harus …").
	Rejection string
}

// GiftIssue asks the gift card context for a card of a paid purchase.
type GiftIssue struct {
	CompanyID, BranchID string
	OrderID             string
	Nominal             float64
	BuyerName           string
	BuyerPhone          string
	Note                string
}

// GiftIssued is the issued card.
type GiftIssued struct {
	ID        string
	Code      string
	ExpiresAt *time.Time
}

// GiftCards is the gift card context (giftcard.gift_cards); q is the
// caller's transaction.
type GiftCards interface {
	Config(ctx context.Context, q Q) (GiftConfig, error)
	Allowed(cfg GiftConfig, nominal float64) bool
	Issue(ctx context.Context, q Q, in GiftIssue) (GiftIssued, error)
}

// GiftOptions is what the bot offers: Available=false when online payment
// or gift cards are not set up.
type GiftOptions struct {
	Available    bool      `json:"available"`
	Presets      []float64 `json:"presets"`
	AllowCustom  bool      `json:"allow_custom"`
	MinIDR       float64   `json:"min_idr"`
	MaxIDR       float64   `json:"max_idr"`
	ExpiryMonths *int      `json:"expiry_months"`
}

// GiftMinIDR / GiftMaxIDR bound a custom nominal bought online.
const (
	GiftMinIDR = 50_000
	GiftMaxIDR = 10_000_000
)

// GiftOrderInput is one purchase.
type GiftOrderInput struct {
	BranchID      string
	Nominal       float64
	BuyerName     string
	BuyerPhone    string
	RecipientName string
	Source        string
}

// GiftOrder is a purchase as the buyer and the bot see it.
type GiftOrder struct {
	ID            string        `json:"-"`
	Token         string        `json:"token"`
	BranchID      string        `json:"branch_id"`
	BranchName    string        `json:"branch_name"`
	NominalIDR    float64       `json:"nominal_idr"`
	BuyerName     string        `json:"buyer_name"`
	BuyerPhone    string        `json:"-"`
	RecipientName *string       `json:"recipient_name"`
	Status        string        `json:"status"`
	PayURL        *string       `json:"pay_url"`
	PayUntil      *httpx.JSTime `json:"pay_until"`
	Code          *string       `json:"code"`
	CardExpiresAt *httpx.JSTime `json:"card_expires_at"`
	PaidAt        *httpx.JSTime `json:"paid_at"`
	Mock          bool          `json:"mock"`
}

func (s *Service) giftReady() bool { return s.onlinePaymentReady() && s.ports.GiftCards != nil }

// PublicGiftOptions lists the nominals a guest may buy.
func (s *Service) PublicGiftOptions(ctx context.Context) (*GiftOptions, error) {
	out := &GiftOptions{Presets: []float64{}, MinIDR: GiftMinIDR, MaxIDR: GiftMaxIDR}
	if !s.giftReady() {
		return out, nil
	}
	cfg, err := s.ports.GiftCards.Config(ctx, s.db)
	if err != nil {
		return nil, err
	}
	for _, p := range cfg.Presets {
		if p >= GiftMinIDR && p <= GiftMaxIDR {
			out.Presets = append(out.Presets, p)
		}
	}
	out.Available, out.AllowCustom, out.ExpiryMonths = len(out.Presets) > 0 || cfg.AllowCustom, cfg.AllowCustom, cfg.ExpiryMonths
	return out, nil
}

// PublicGiftOrder records a purchase and returns its payment link.
func (s *Service) PublicGiftOrder(ctx context.Context, in GiftOrderInput) (*GiftOrder, error) {
	if !s.giftReady() {
		return nil, httpx.Status(503, "Pembelian gift voucher online belum tersedia. Silakan beli di outlet.")
	}
	in.BuyerName, in.RecipientName = strings.TrimSpace(in.BuyerName), strings.TrimSpace(in.RecipientName)
	phone := domain.NormalizePhone(in.BuyerPhone)
	switch {
	case in.BuyerName == "" || len([]rune(in.BuyerName)) > 120:
		return nil, httpx.BadRequest("Nama pembeli wajib diisi")
	case len(phone) < 8 || len(phone) > 25:
		return nil, httpx.BadRequest("Nomor HP pembeli tidak valid")
	case len([]rune(in.RecipientName)) > 120:
		return nil, httpx.BadRequest("Nama penerima terlalu panjang")
	case in.Nominal < GiftMinIDR || in.Nominal > GiftMaxIDR || in.Nominal != math.Trunc(in.Nominal):
		return nil, httpx.BadRequest("Nominal gift voucher " + domainRupiah(GiftMinIDR) + "–" + domainRupiah(GiftMaxIDR))
	}
	if in.Source == "" {
		in.Source = "whatsapp"
	}
	outlet, err := s.publicOutlet(ctx, s.db, in.BranchID)
	if err != nil {
		return nil, err
	}
	if outlet.CompanyID == nil {
		return nil, httpx.BadRequest("Outlet belum terhubung ke perusahaan")
	}
	cfg, err := s.ports.GiftCards.Config(ctx, s.db)
	if err != nil {
		return nil, err
	}
	if !s.ports.GiftCards.Allowed(cfg, in.Nominal) {
		return nil, httpx.BadRequest(firstNonEmpty(cfg.Rejection, "Nominal gift voucher tidak tersedia"))
	}
	var id, token string
	err = s.db.QueryRow(ctx, `INSERT INTO spa.gift_orders (branch_id, company_id, nominal_idr, buyer_name, buyer_phone, recipient_name, source)
	  VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7) RETURNING id::text, public_token::text`,
		in.BranchID, *outlet.CompanyID, in.Nominal, in.BuyerName, phone, in.RecipientName, in.Source).Scan(&id, &token)
	if err != nil {
		return nil, err
	}
	statusURL := appOrigin() + "/booking/spa/gift/" + token
	inv, err := s.ports.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID:  spaGiftPrefix + id,
		Amount:      in.Nominal,
		PayerName:   in.BuyerName,
		Description: "Gift voucher Mizu " + outlet.BranchName + " " + domainRupiah(in.Nominal),
		RedirectURL: statusURL,
	})
	if err != nil {
		if s.log != nil {
			s.log.Error("[spa] invoice gift voucher", "order", id, "error", err)
		}
		_, _ = s.db.Exec(ctx, `UPDATE spa.gift_orders SET status = 'expired', updated_at = now() WHERE id = $1`, id)
		return nil, httpx.Status(502, "Pembayaran online sedang gangguan. Coba lagi sebentar.")
	}
	if inv.Mock {
		inv.URL = statusURL + "?bayar=simulasi" // no hosted page in mock mode
	}
	if _, err := s.db.Exec(ctx, `UPDATE spa.gift_orders SET xendit_invoice_id = $2, xendit_invoice_url = $3, invoice_expires_at = $4,
	    updated_at = now() WHERE id = $1`, id, inv.ID, inv.URL, inv.ExpiresAt); err != nil {
		return nil, err
	}
	return s.PublicGiftOrderStatus(ctx, token)
}

const giftColumns = `g.id::text, g.public_token::text, g.branch_id::text, b.name, g.nominal_idr::float8, g.buyer_name, g.buyer_phone,
	g.recipient_name, g.status, g.xendit_invoice_id, g.xendit_invoice_url, g.invoice_expires_at, g.gift_card_code, g.card_expires_at, g.paid_at`

func scanGift(row interface{ Scan(...any) error }) (*GiftOrder, *string, error) {
	var g GiftOrder
	var invoiceID *string
	var payUntil, cardExpires, paidAt *time.Time
	err := row.Scan(&g.ID, &g.Token, &g.BranchID, &g.BranchName, &g.NominalIDR, &g.BuyerName, &g.BuyerPhone,
		&g.RecipientName, &g.Status, &invoiceID, &g.PayURL, &payUntil, &g.Code, &cardExpires, &paidAt)
	if err != nil {
		return nil, nil, err
	}
	g.PayUntil, g.CardExpiresAt, g.PaidAt = jsTimePtr(payUntil), jsTimePtr(cardExpires), jsTimePtr(paidAt)
	g.Mock = invoiceID != nil && strings.HasPrefix(*invoiceID, "mock-")
	return &g, invoiceID, nil
}

func jsTimePtr(t *time.Time) *httpx.JSTime {
	if t == nil {
		return nil
	}
	v := httpx.JSTime(*t)
	return &v
}

// PublicGiftOrderStatus reads a purchase by token, asking Xendit when it is
// still pending (back from the payment page before the webhook lands).
func (s *Service) PublicGiftOrderStatus(ctx context.Context, token string) (*GiftOrder, error) {
	g, invoiceID, err := scanGift(s.db.QueryRow(ctx, `SELECT `+giftColumns+`
	   FROM spa.gift_orders g JOIN configuration.branches b ON b.id = g.branch_id WHERE g.public_token = $1::uuid`, token))
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Gift voucher tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if g.Status != GiftPending || invoiceID == nil {
		return g, nil
	}
	if g.PayUntil != nil && time.Time(*g.PayUntil).Before(s.clock()) {
		if _, err := s.db.Exec(ctx, `UPDATE spa.gift_orders SET status = 'expired', xendit_invoice_url = NULL, updated_at = now()
		  WHERE id = $1 AND status = 'pending'`, g.ID); err != nil {
			return nil, err
		}
		g.Status, g.PayURL = GiftExpired, nil
		return g, nil
	}
	if !g.Mock && s.onlinePaymentReady() {
		sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		status, err := s.ports.Payments.InvoiceStatus(sctx, *invoiceID)
		cancel()
		if err == nil && (status == "PAID" || status == "SETTLED") {
			if _, err := s.settleGift(ctx, g.ID, *invoiceID, "Xendit"); err != nil {
				return nil, err
			}
			return s.PublicGiftOrderStatus(ctx, token)
		}
		if err != nil && s.log != nil && !errors.Is(err, context.Canceled) {
			s.log.Warn("[spa] cek invoice gift voucher", "error", err)
		}
	}
	return g, nil
}

// settleGift marks a purchase paid and issues its card in one transaction;
// idempotent (a paid order is left alone).
func (s *Service) settleGift(ctx context.Context, orderID, invoiceID, via string) (bool, error) {
	settled := false
	err := s.tx(ctx, func(q Q) error {
		var companyID, branchID, buyerName, buyerPhone, status string
		var nominal float64
		var recipient *string
		err := q.QueryRow(ctx, `SELECT company_id::text, branch_id::text, buyer_name, buyer_phone, status, nominal_idr::float8, recipient_name
		   FROM spa.gift_orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&companyID, &branchID, &buyerName, &buyerPhone, &status, &nominal, &recipient)
		if database.IsNoRows(err) || (err == nil && status == GiftPaid) {
			return nil
		}
		if err != nil {
			return err
		}
		note := "Gift voucher dibeli online (" + via + ")"
		if recipient != nil && *recipient != "" {
			note += " untuk " + *recipient
		}
		card, err := s.ports.GiftCards.Issue(ctx, q, GiftIssue{CompanyID: companyID, BranchID: branchID, OrderID: orderID,
			Nominal: nominal, BuyerName: buyerName, BuyerPhone: buyerPhone, Note: note})
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE spa.gift_orders SET status = 'paid', paid_at = now(), gift_card_id = $2, gift_card_code = $3,
		    card_expires_at = $4, xendit_invoice_id = COALESCE(NULLIF($5, ''), xendit_invoice_id), updated_at = now() WHERE id = $1`,
			orderID, card.ID, card.Code, card.ExpiresAt, invoiceID); err != nil {
			return err
		}
		settled = true
		g, _, err := scanGift(q.QueryRow(ctx, `SELECT `+giftColumns+`
		   FROM spa.gift_orders g JOIN configuration.branches b ON b.id = g.branch_id WHERE g.id = $1`, orderID))
		if err != nil {
			return err
		}
		return outbox.Publish(ctx, q, TopicGiftOrderPaid, orderID, giftNotice(g))
	})
	return settled, err
}

// GiftNotice is the TopicGiftOrderPaid payload (the order with the buyer's phone).
type GiftNotice struct {
	GiftOrder
	Phone string `json:"phone"`
}

func giftNotice(g *GiftOrder) GiftNotice { return GiftNotice{GiftOrder: *g, Phone: g.BuyerPhone} }

// giftCallback settles or expires a gift voucher invoice.
func (s *Service) giftCallback(ctx context.Context, id string, cb InvoiceCallback) (string, error) {
	switch strings.ToUpper(cb.Status) {
	case "PAID", "SETTLED":
		var amount float64
		if err := s.db.QueryRow(ctx, `SELECT nominal_idr::float8 FROM spa.gift_orders WHERE id = $1`, id).Scan(&amount); err != nil {
			if database.IsNoRows(err) {
				return "ignored", nil
			}
			return "", err
		}
		if cb.PaidAmount != nil && *cb.PaidAmount < amount {
			if s.log != nil {
				s.log.Error("[spa] Xendit PAID below gift voucher amount", "order", id, "paid", *cb.PaidAmount, "amount", amount)
			}
			return "unchanged", nil
		}
		settled, err := s.settleGift(ctx, id, cb.ID, "Xendit")
		if err != nil {
			return "", err
		}
		if settled {
			return "gift_paid", nil
		}
		return "unchanged", nil
	case "EXPIRED":
		_, err := s.db.Exec(ctx, `UPDATE spa.gift_orders SET status = 'expired', xendit_invoice_url = NULL, updated_at = now()
		  WHERE id = $1 AND xendit_invoice_id = $2 AND status = 'pending'`, id, cb.ID)
		return "expired", err
	}
	return "ignored", nil
}

// PublicGiftMockPay completes a simulated gift voucher payment (XENDIT_MOCK=1 only).
func (s *Service) PublicGiftMockPay(ctx context.Context, token string) (*GiftOrder, error) {
	if s.ports.Payments == nil || !s.ports.Payments.Mock() {
		return nil, httpx.NotFound("Tidak tersedia")
	}
	var id string
	var invoiceID *string
	err := s.db.QueryRow(ctx, `SELECT id::text, xendit_invoice_id FROM spa.gift_orders WHERE public_token = $1::uuid`, token).Scan(&id, &invoiceID)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Gift voucher tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if invoiceID == nil || !strings.HasPrefix(*invoiceID, "mock-") {
		return nil, httpx.Conflict("Belum ada pembayaran simulasi untuk gift voucher ini")
	}
	if _, err := s.settleGift(ctx, id, *invoiceID, "simulasi Xendit"); err != nil {
		return nil, err
	}
	return s.PublicGiftOrderStatus(ctx, token)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
