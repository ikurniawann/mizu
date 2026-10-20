package spa

import (
	"context"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
)

type createGroupInput struct {
	BranchID        string
	PayerCustomerID string
	PayerName       string
	PayerPhone      string
	Bookings        []createBookingInput
}

func (s *Service) CreateBookingGroup(ctx context.Context, userID string, in createGroupInput) (*BookingGroup, error) {
	if len(in.Bookings) < 2 || len(in.Bookings) > 10 {
		return nil, httpx.BadRequest("Booking bersama memerlukan 2–10 orang")
	}
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	var id string
	err = s.tx(ctx, func(q Q) error {
		o, err := s.outletIn(ctx, q, sc, in.BranchID)
		if err != nil {
			return err
		}
		if !o.IsActive {
			return httpx.BadRequest("Outlet spa sedang tidak aktif")
		}
		payerID, phone, err := s.customer(ctx, q, in.PayerCustomerID, in.PayerName, in.PayerPhone)
		if err != nil {
			return err
		}
		err = q.QueryRow(ctx, `INSERT INTO spa.booking_groups (branch_id, payer_customer_id, payer_name, payer_phone, created_by)
		  VALUES ($1, $2::uuid, $3, $4, $5::uuid) RETURNING id::text`, in.BranchID, payerID, in.PayerName, phone, userID).Scan(&id)
		if err != nil {
			return err
		}
		for position, member := range in.Bookings {
			if member.BranchID != in.BranchID {
				return httpx.BadRequest("Semua booking bersama harus pada outlet yang sama")
			}
			for _, item := range member.Items {
				if item.TherapistID == "" {
					continue
				}
				if member.TherapistID != "" && member.TherapistID != item.TherapistID {
					return httpx.BadRequest("Satu booking hanya dapat ditugaskan ke satu terapis")
				}
				member.TherapistID = item.TherapistID
			}
			if _, err := s.createBookingIn(ctx, q, sc, userID, member, &id, position); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.bookingGroup(ctx, s.db, sc, id, false)
}

func (s *Service) BookingGroup(ctx context.Context, userID, id string) (*BookingGroup, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.maintain(ctx)
	return s.bookingGroup(ctx, s.db, sc, id, false)
}

func (s *Service) bookingGroup(ctx context.Context, q Q, sc *scope.Scope, id string, lock bool) (*BookingGroup, error) {
	var g BookingGroup
	var companyID *string
	query := `SELECT g.id::text, g.branch_id::text, b.company_id::text, g.payer_customer_id::text, g.payer_name, g.payer_phone
	  FROM spa.booking_groups g JOIN configuration.branches b ON b.id = g.branch_id WHERE g.id = $1`
	if lock {
		query += ` FOR UPDATE OF g`
	}
	err := q.QueryRow(ctx, query, id).Scan(&g.ID, &g.BranchID, &companyID, &g.PayerCustomerID, &g.PayerName, &g.PayerPhone)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Grup booking tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if !inScope(sc, companyID, g.BranchID) {
		return nil, httpx.NotFound("Grup booking tidak ditemukan")
	}
	rows, err := q.Query(ctx, `SELECT id::text FROM spa.bookings WHERE group_id = $1 ORDER BY group_position, id`, id)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, memberID)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	g.Bookings = make([]*Booking, 0, len(ids))
	for _, memberID := range ids {
		b, err := s.st.bookingDetail(ctx, q, memberID)
		if err != nil {
			return nil, err
		}
		if b != nil {
			g.Bookings = append(g.Bookings, b)
		}
	}
	return &g, nil
}

// CheckoutBookingGroup opens exactly one bill for every non-cancelled visit.
func (s *Service) CheckoutBookingGroup(ctx context.Context, userID, id string, ratings map[string]int) (*GroupCheckoutResult, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	var ref OrderRef
	err = s.tx(ctx, func(q Q) error {
		g, err := s.bookingGroup(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		var active []*bookingRow
		for _, member := range g.Bookings {
			b, err := s.lockBooking(ctx, q, sc, member.ID)
			if err != nil {
				return err
			}
			if b.Status == domain.BookingCancelled {
				continue
			}
			items, err := s.st.itemRows(ctx, q, b.ID, true)
			if err != nil {
				return err
			}
			statuses := make([]string, len(items))
			for i, item := range items {
				statuses[i] = item.Status
			}
			if err := domain.CanCheckout(b.Status, b.PaymentStatus, statuses); err != nil {
				return ruleErr(err)
			}
			if b.TherapistID == nil {
				return httpx.Conflict("Terapis booking belum ditugaskan")
			}
			rating, ok := ratings[b.ID]
			if !ok && b.TherapistRating != nil {
				rating = *b.TherapistRating
				ok = true
			}
			if !ok || rating < 1 || rating > 5 {
				return httpx.BadRequest("Rating terapis 1–5 bintang wajib diisi untuk setiap orang")
			}
			if b.TherapistRating != nil && *b.TherapistRating != rating {
				return httpx.Conflict("Rating terapis sudah tercatat untuk booking ini")
			}
			active = append(active, b)
		}
		if len(active) == 0 {
			return httpx.Conflict("Tidak ada booking aktif untuk checkout")
		}
		for bookingID := range ratings {
			found := false
			for _, b := range active {
				if b.ID == bookingID {
					found = true
					break
				}
			}
			if !found {
				return httpx.BadRequest("Rating berisi booking yang tidak aktif")
			}
		}
		var existing string
		for _, b := range active {
			if b.PosOrderID == nil {
				continue
			}
			if existing != "" && existing != *b.PosOrderID {
				return httpx.Conflict("Tagihan grup tidak konsisten")
			}
			existing = *b.PosOrderID
		}
		if existing != "" {
			for _, b := range active {
				if b.PosOrderID == nil {
					return httpx.Conflict("Tagihan grup tidak konsisten")
				}
			}
			states, err := s.ports.POS.OrderStates(ctx, q, []string{existing})
			if err != nil {
				return err
			}
			if state, ok := states[existing]; ok && state.Live() {
				if state.Paid() {
					return httpx.Conflict("Booking sudah dibayar")
				}
				ref = OrderRef{ID: existing, Number: state.Number}
				return nil
			}
		}
		o, err := s.outletIn(ctx, q, nil, g.BranchID)
		if err != nil {
			return err
		}
		lines := []BillLine{}
		products := map[string]string{}
		for _, b := range active {
			detail, err := s.st.items(ctx, q, b.ID)
			if err != nil {
				return err
			}
			ids := make([]string, 0, len(detail))
			for _, item := range detail {
				ids = append(ids, item.VariantID)
			}
			variants, err := s.st.variants(ctx, q, ids, b.BranchID)
			if err != nil {
				return err
			}
			for _, item := range detail {
				if item.Status == domain.ItemCancelled {
					continue
				}
				v := variants[item.VariantID]
				pid, ok := products[v.ID]
				if !ok {
					pid, err = s.ensureProduct(ctx, q, o, v)
					if err != nil {
						return err
					}
					products[v.ID] = pid
				}
				note := "Pelanggan: " + b.CustomerName
				if item.TherapistName != nil {
					note += " · Terapis: " + *item.TherapistName
				}
				lines = append(lines, BillLine{ProductID: pid, Name: item.TreatmentName + " (" + item.VariantName + ")", SKU: "SPA-" + v.TreatmentCode, UnitPrice: item.PriceIDR, Note: note})
			}
		}
		first := active[0]
		ref, err = s.ports.POS.OpenBill(ctx, q, Bill{CompanyID: first.CompanyID, BranchID: first.BranchID, WarehouseID: first.WarehouseID,
			CustomerID: g.PayerCustomerID, CashierUserID: userID, ContactName: g.PayerName, ContactPhone: g.PayerPhone,
			Notes: "Booking spa bersama", Lines: lines})
		if err != nil {
			return err
		}
		for _, b := range active {
			rating := ratings[b.ID]
			if rating == 0 && b.TherapistRating != nil {
				rating = *b.TherapistRating
			}
			if err := s.st.setCheckout(ctx, q, b.ID, ref.ID, s.clock(), rating); err != nil {
				return err
			}
			if err := s.st.event(ctx, q, b.ID, nil, "checkout", nil, nil, userID, "Tagihan POS "+ref.Number); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	g, err := s.bookingGroup(ctx, s.db, sc, id, false)
	if err != nil {
		return nil, err
	}
	return &GroupCheckoutResult{Group: g, OrderID: ref.ID, OrderNumber: ref.Number}, nil
}
