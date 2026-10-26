package spa

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Rooms (revisi R6/R9) ─────────────────────────────────────────────
   An outlet's rooms carry a price; a booking may take one room for its
   window (no two open bookings share a room at the same time). The room
   board shows each room's state and the running treatment's countdown. */

// Room is a treatment room of an outlet.
type Room struct {
	ID          string  `json:"id"`
	BranchID    string  `json:"branch_id"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Capacity    int     `json:"capacity"`
	PriceIDR    float64 `json:"price_idr"`
	Description string  `json:"description"`
	IsActive    bool    `json:"is_active"`
	SortOrder   int     `json:"sort_order"`
}

type roomInput struct {
	BranchID    string
	Name        string
	Category    string
	Capacity    int
	PriceIDR    float64
	Description string
	IsActive    bool
	SortOrder   int
}

// Room states on the board.
const (
	RoomFree     = "free"     // nothing now, nothing starting soon
	RoomReserved = "reserved" // a booking starts within the hour (or is late to start)
	RoomOccupied = "occupied" // a treatment is running
	RoomDone     = "done"     // finished, guest not sent to the cashier yet
	RoomInactive = "inactive"
)

// RoomReservedWindow: how long before its start a booking shows its room as reserved.
const RoomReservedWindow = 60 * time.Minute

// RoomOccupant is the booking in (or next for) a room.
type RoomOccupant struct {
	BookingID     string        `json:"booking_id"`
	BookingCode   string        `json:"booking_code"`
	CustomerName  string        `json:"customer_name"`
	TherapistName *string       `json:"therapist_name"`
	Treatments    []string      `json:"treatments"`
	Status        string        `json:"status"`
	ScheduledAt   httpx.JSTime  `json:"scheduled_at"`
	EndsAt        httpx.JSTime  `json:"ends_at"`
	StartedAt     *httpx.JSTime `json:"started_at"`
	// DurationMin is the total of the non-cancelled treatments; the timer
	// counts down from started_at + duration.
	DurationMin int `json:"duration_min"`
}

// RoomBoardEntry is one room with its state right now.
type RoomBoardEntry struct {
	Room
	State   string        `json:"state"`
	Current *RoomOccupant `json:"current"`
	Next    *RoomOccupant `json:"next"`
}

// RoomBoard is GET /api/spa/room-board.
type RoomBoard struct {
	BranchID string           `json:"branch_id"`
	At       httpx.JSTime     `json:"at"`
	Rooms    []RoomBoardEntry `json:"rooms"`
}

/* ── store ───────────────────────────────────────────────────────────── */

const roomColumns = `id::text, branch_id::text, name, capacity, price_idr::float8, description, is_active, sort_order, category`

func scanRoom(r pgx.Row) (Room, error) {
	var x Room
	err := r.Scan(&x.ID, &x.BranchID, &x.Name, &x.Capacity, &x.PriceIDR, &x.Description, &x.IsActive, &x.SortOrder, &x.Category)
	return x, err
}

func (store) rooms(ctx context.Context, q Q, branchID string, activeOnly bool) ([]Room, error) {
	sql := `SELECT ` + roomColumns + ` FROM spa.rooms WHERE branch_id = $1`
	if activeOnly {
		sql += ` AND is_active`
	}
	return many(ctx, q, scanRoom, sql+` ORDER BY sort_order, name`, branchID)
}

func (store) room(ctx context.Context, q Q, id string) (*Room, error) {
	r, err := scanRoom(q.QueryRow(ctx, `SELECT `+roomColumns+` FROM spa.rooms WHERE id = $1`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &r, err
}

func (store) roomNameTaken(ctx context.Context, q Q, branchID, name, exceptID string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM spa.rooms WHERE branch_id = $1 AND lower(name) = lower($2) AND id::text <> $3)`,
		branchID, name, exceptID).Scan(&taken)
	return taken, err
}

func (store) insertRoom(ctx context.Context, q Q, in roomInput) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO spa.rooms (branch_id, name, capacity, price_idr, description, is_active, sort_order, category)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
		in.BranchID, in.Name, in.Capacity, in.PriceIDR, in.Description, in.IsActive, in.SortOrder, in.Category).Scan(&id)
	return id, err
}

func (store) updateRoom(ctx context.Context, q Q, id string, in roomInput) error {
	_, err := q.Exec(ctx, `UPDATE spa.rooms SET name = $2, capacity = $3, price_idr = $4, description = $5, is_active = $6,
	    sort_order = $7, category = $8, updated_at = now() WHERE id = $1`, id, in.Name, in.Capacity, in.PriceIDR, in.Description, in.IsActive, in.SortOrder, in.Category)
	return err
}

func (store) deleteRoom(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM spa.rooms WHERE id = $1
	  AND NOT EXISTS (SELECT 1 FROM spa.bookings WHERE room_id = $1)`, id)
	return tag.RowsAffected() > 0, err
}

// roomUse counts the other open bookings holding the room within
// [start, end) and names the first of them. A room holds as many bookings at
// once as its capacity (a couple room takes two guests).
func (store) roomUse(ctx context.Context, q Q, roomID, bookingID string, start, end time.Time) (int, string, error) {
	var n int
	var code *string
	err := q.QueryRow(ctx, `SELECT count(*)::int, min(booking_code) FROM spa.bookings
	   WHERE room_id = $1 AND id::text <> $2 AND status IN ($3, $4, $5) AND scheduled_at < $7 AND ends_at > $6`,
		roomID, bookingID, domain.BookingUnassigned, domain.BookingAssigned, domain.BookingInTreatment, start, end).Scan(&n, &code)
	if code == nil {
		return n, "", err
	}
	return n, *code, err
}

// lockRooms gives multi-room bookings the same lock order regardless of guest order.
func (store) lockRooms(ctx context.Context, q Q, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `SELECT id FROM spa.rooms WHERE id = ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE`, ids)
	return err
}

// roomConflict returns the code of a booking that leaves no place for one
// more guest in the room within [start, end), or "".
func (st store) roomConflict(ctx context.Context, q Q, roomID, bookingID string, start, end time.Time) (string, error) {
	var capacity int
	if err := q.QueryRow(ctx, `SELECT capacity FROM spa.rooms WHERE id = $1 FOR NO KEY UPDATE`, roomID).Scan(&capacity); err != nil {
		return "", err
	}
	n, code, err := st.roomUse(ctx, q, roomID, bookingID, start, end)
	if err != nil || n < capacity {
		return "", err
	}
	return code, nil
}

func (store) setBookingRoom(ctx context.Context, q Q, bookingID string, roomID *string, price float64) error {
	_, err := q.Exec(ctx, `UPDATE spa.bookings SET room_id = $2::uuid, room_price_idr = $3, updated_at = now() WHERE id = $1`, bookingID, roomID, price)
	return err
}

// roomOccupants lists today's room-holding bookings of an outlet.
func (store) roomOccupants(ctx context.Context, q Q, branchID string, start, end time.Time) (map[string][]RoomOccupant, error) {
	type row struct {
		roomID string
		o      RoomOccupant
	}
	rows, err := many(ctx, q, func(r pgx.Row) (row, error) {
		var x row
		var at, ends time.Time
		var started *time.Time
		err := r.Scan(&x.roomID, &x.o.BookingID, &x.o.BookingCode, &x.o.CustomerName, &x.o.TherapistName, &x.o.Treatments, &x.o.Status,
			&at, &ends, &started, &x.o.DurationMin)
		x.o.ScheduledAt, x.o.EndsAt = jsTime(at), jsTime(ends)
		if started != nil {
			s := jsTime(*started)
			x.o.StartedAt = &s
		}
		if x.o.Treatments == nil {
			x.o.Treatments = []string{}
		}
		return x, err
	}, `SELECT b.room_id::text, b.id::text, b.booking_code, b.customer_name, e.full_name,
	        COALESCE((SELECT array_agg(i.treatment_name || ' · ' || i.variant_name ORDER BY i.sort_order)
	                  FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled'), '{}'),
	        b.status, b.scheduled_at, b.ends_at,
	        (SELECT min(i.started_at) FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled'),
	        COALESCE((SELECT sum(i.duration_min) FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled'), 0)::int
	   FROM spa.bookings b
	   LEFT JOIN spa.therapists t ON t.id = b.therapist_id
	   LEFT JOIN hris.employees e ON e.id = t.employee_id
	  WHERE b.branch_id = $1 AND b.room_id IS NOT NULL AND b.scheduled_at >= $2 AND b.scheduled_at < $3
	    AND b.status IN ('unassigned', 'assigned', 'in_treatment', 'completed') AND b.checked_out_at IS NULL
	  ORDER BY b.scheduled_at`, branchID, start, end)
	if err != nil {
		return nil, err
	}
	out := map[string][]RoomOccupant{}
	for _, x := range rows {
		out[x.roomID] = append(out[x.roomID], x.o)
	}
	return out, nil
}

/* ── service ─────────────────────────────────────────────────────────── */

// Rooms lists an outlet's rooms (all, for management; active only for pickers).
func (s *Service) Rooms(ctx context.Context, userID, branchID string, activeOnly bool) ([]Room, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	return s.st.rooms(ctx, s.db, branchID, activeOnly)
}

// SaveRoom creates (id == "") or updates a room.
func (s *Service) SaveRoom(ctx context.Context, userID, id string, in roomInput) (*Room, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return nil, httpx.BadRequest("Nama room wajib diisi")
	}
	if in.Capacity < 1 {
		in.Capacity = 1
	}
	if id != "" {
		existing, err := s.st.room(ctx, s.db, id)
		if err != nil {
			return nil, err
		}
		if existing == nil {
			return nil, httpx.NotFound("Room tidak ditemukan")
		}
		in.BranchID = existing.BranchID
		if in.Category == "" {
			in.Category = existing.Category
		}
	}
	if in.Category == "" {
		in.Category = "public"
	}
	if in.Category != "public" && in.Category != "private" {
		return nil, httpx.BadRequest("Kategori room harus Public atau Private")
	}
	if _, err := s.outletIn(ctx, s.db, sc, in.BranchID); err != nil {
		return nil, err
	}
	// Checked here (not left to the unique index) so the error is a clean 409.
	taken, err := s.st.roomNameTaken(ctx, s.db, in.BranchID, in.Name, id)
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, httpx.Conflict("Nama room sudah dipakai di outlet ini")
	}
	if id == "" {
		if id, err = s.st.insertRoom(ctx, s.db, in); err != nil {
			return nil, err
		}
	} else if err := s.st.updateRoom(ctx, s.db, id, in); err != nil {
		return nil, err
	}
	return s.st.room(ctx, s.db, id)
}

// DeleteRoom removes a room only when no booking has ever used it.
func (s *Service) DeleteRoom(ctx context.Context, userID, id string) error {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return err
	}
	room, err := s.st.room(ctx, s.db, id)
	if err != nil {
		return err
	}
	if room == nil {
		return httpx.NotFound("Room tidak ditemukan")
	}
	if _, err := s.outletIn(ctx, s.db, sc, room.BranchID); err != nil {
		return err
	}
	deleted, err := s.st.deleteRoom(ctx, s.db, id)
	if database.PgCode(err) == "23503" {
		return httpx.Conflict("Room sudah dipakai booking; nonaktifkan room jika tidak digunakan lagi")
	}
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.Conflict("Room sudah dipakai booking; nonaktifkan room jika tidak digunakan lagi")
	}
	return nil
}

func (s *Service) roomOperator(ctx context.Context, userID string) (bool, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return false, err
	}
	if sc.Role != nil && *sc.Role == "spa_therapist" {
		return false, nil
	}
	therapist, err := s.Me(ctx, userID)
	return therapist == nil, err
}

// SetBookingRoom puts a booking in a room (roomID "" releases it). The room
// must belong to the outlet, be active and free for the booking's window;
// the room price is snapshotted onto the booking and billed at checkout.
func (s *Service) SetBookingRoom(ctx context.Context, userID, bookingID, roomID string) (*Booking, error) {
	allowed, err := s.roomOperator(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, httpx.Forbidden("Hanya admin yang boleh memindahkan room; terapis tidak diperbolehkan")
	}
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, bookingID)
		if err != nil {
			return err
		}
		return s.assignRoomIn(ctx, q, userID, b, roomID)
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, bookingID)
}

func (s *Service) assignRoomIn(ctx context.Context, q Q, userID string, b *bookingRow, roomID string) error {
	return s.assignRoom(ctx, q, userID, b, roomID, false)
}

// assignRoom puts the booking in the room; waivePrice charges no room price
// (the second guest of a party sharing the room — the price counts once).
func (s *Service) assignRoom(ctx context.Context, q Q, userID string, b *bookingRow, roomID string, waivePrice bool) error {
	if err := domain.CanChangeRoom(b.Status, b.CheckedOutAt != nil, roomID == ""); err != nil {
		return ruleErr(err)
	}
	if deref(b.RoomID) == roomID {
		return nil
	}
	oldName := "Tanpa room"
	if b.RoomID != nil {
		oldRoom, err := s.st.room(ctx, q, *b.RoomID)
		if err != nil {
			return err
		}
		if oldRoom != nil {
			oldName = oldRoom.Name
		}
	}
	if roomID == "" {
		if err := s.checkRoomPayment(ctx, q, b, 0); err != nil {
			return err
		}
		if err := s.st.setBookingRoom(ctx, q, b.ID, nil, 0); err != nil {
			return err
		}
		return s.st.event(ctx, q, b.ID, nil, "room", b.RoomID, nil, userID, fmt.Sprintf("%s → Tanpa room · %s → Rp 0", oldName, domainRupiah(b.RoomPriceIDR)))
	}
	// NO KEY UPDATE serializes capacity writers without conflicting with
	// the foreign-key KEY SHARE locks of bookings already using this room.
	room, err := scanRoom(q.QueryRow(ctx, `SELECT `+roomColumns+` FROM spa.rooms WHERE id=$1 FOR NO KEY UPDATE`, roomID))
	if database.IsNoRows(err) {
		return httpx.BadRequest("Room tidak ditemukan di outlet ini")
	}
	if err != nil {
		return err
	}
	if room.BranchID != b.BranchID {
		return httpx.BadRequest("Room tidak ditemukan di outlet ini")
	}
	if !room.IsActive {
		return httpx.Conflict("Room " + room.Name + " sedang nonaktif")
	}
	code, err := s.st.roomConflict(ctx, q, room.ID, b.ID, b.ScheduledAt, b.EndsAt)
	if err != nil {
		return err
	}
	if code != "" {
		return httpx.Conflict("Room " + room.Name + " sudah dipakai booking " + code + " pada jam itu")
	}
	price := room.PriceIDR
	if waivePrice {
		price = 0
	}
	if err := s.checkRoomPayment(ctx, q, b, price); err != nil {
		return err
	}
	if err := s.st.setBookingRoom(ctx, q, b.ID, &room.ID, price); err != nil {
		return err
	}
	return s.st.event(ctx, q, b.ID, nil, "room", b.RoomID, &room.ID, userID, fmt.Sprintf("%s → %s · %s → %s", oldName, room.Name, domainRupiah(b.RoomPriceIDR), domainRupiah(price)))
}

// Full online invoices cannot be repriced without reconciling the payment.
// DP is independent: it remains a credit against the new booking total.
func (s *Service) checkRoomPayment(ctx context.Context, q Q, b *bookingRow, price float64) error {
	if price == b.RoomPriceIDR {
		return nil
	}
	var invoiced bool
	if err := q.QueryRow(ctx, `SELECT xendit_invoice_id IS NOT NULL OR invoice_amount_idr IS NOT NULL FROM spa.bookings WHERE id=$1`, b.ID).Scan(&invoiced); err != nil {
		return err
	}
	if b.PaymentStatus == domain.PaymentPaid || invoiced {
		return httpx.Conflict("Booking sudah memiliki tagihan atau pembayaran online penuh; rekonsiliasi pembayaran terlebih dahulu sebelum pindah ke room dengan tarif berbeda")
	}
	return nil
}

// checkRoomWindow re-validates a booking's room after its window moved.
func (s *Service) checkRoomWindow(ctx context.Context, q Q, bookingID string, start, end time.Time) error {
	var roomID *string
	if err := q.QueryRow(ctx, `SELECT room_id::text FROM spa.bookings WHERE id = $1`, bookingID).Scan(&roomID); err != nil {
		return err
	}
	if roomID == nil {
		return nil
	}
	code, err := s.st.roomConflict(ctx, q, *roomID, bookingID, start, end)
	if err != nil {
		return err
	}
	if code != "" {
		return httpx.Conflict("Room sudah dipakai booking " + code + " pada jam baru; lepas atau ganti room dulu")
	}
	return nil
}

// RoomBoard shows every room of an outlet with its state now.
func (s *Service) RoomBoard(ctx context.Context, userID, branchID string) (*RoomBoard, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	s.maintain(ctx)
	now := s.clock()
	day := now.In(domain.WIB).Format("2006-01-02")
	start, end, _ := domain.DayBounds(day)
	rooms, err := s.st.rooms(ctx, s.db, branchID, false)
	if err != nil {
		return nil, err
	}
	occ, err := s.st.roomOccupants(ctx, s.db, branchID, start, end)
	if err != nil {
		return nil, err
	}
	board := &RoomBoard{BranchID: branchID, At: jsTime(now), Rooms: make([]RoomBoardEntry, 0, len(rooms))}
	for _, r := range rooms {
		board.Rooms = append(board.Rooms, roomState(r, occ[r.ID], now))
	}
	return board, nil
}

// roomState derives a room's state from today's bookings in it.
func roomState(r Room, bookings []RoomOccupant, now time.Time) RoomBoardEntry {
	e := RoomBoardEntry{Room: r, State: RoomFree}
	if !r.IsActive {
		e.State = RoomInactive
	}
	occupied := false
	for i := range bookings {
		b := &bookings[i]
		ends := time.Time(b.EndsAt)
		switch {
		case b.Status == domain.BookingInTreatment:
			e.Current, occupied = b, true
		case b.Status == domain.BookingCompleted:
			if e.Current == nil && !ends.Before(now.Add(-2*time.Hour)) {
				e.Current = b // finished, guest not sent to the cashier yet
			}
		default: // upcoming (unassigned/assigned)
			if ends.Before(now) {
				continue // never started and already past: the sweep will expire it
			}
			if e.Next == nil {
				e.Next = b
			}
		}
	}
	switch {
	case !r.IsActive:
		e.State = RoomInactive
	case occupied:
		e.State = RoomOccupied
	case e.Current != nil:
		e.State = RoomDone
	case e.Next != nil && time.Time(e.Next.ScheduledAt).Before(now.Add(RoomReservedWindow)):
		e.State = RoomReserved
	}
	return e
}

// roomBillLine is the POS line for a booking's room: a per-outlet POS
// product "Room <name>" (category "Room Spa") like treatment products.
func (s *Service) roomBillLine(ctx context.Context, q Q, o *outletRow, roomID string, price float64) (BillLine, error) {
	room, err := s.st.room(ctx, q, roomID)
	if err != nil {
		return BillLine{}, err
	}
	if room == nil {
		return BillLine{}, httpx.Conflict("Room booking tidak ditemukan")
	}
	rid := strings.ToUpper(strings.ReplaceAll(room.ID, "-", ""))
	branch := strings.ToUpper(strings.ReplaceAll(o.BranchID, "-", ""))[:6]
	pid, err := s.ports.POS.EnsureTreatmentProduct(ctx, q, TreatmentProduct{
		CompanyID: o.CompanyID, BranchID: o.BranchID, WarehouseID: o.WarehouseID,
		Code: "ROOM-" + rid[:12], SKU: "ROOM-" + rid[:8] + "-" + branch, Name: "Room " + room.Name, Category: "Room Spa",
		Price: price, Active: true,
	})
	if err != nil {
		return BillLine{}, err
	}
	return BillLine{ProductID: pid, Name: "Room " + room.Name, SKU: "ROOM-" + rid[:8], UnitPrice: price, Note: "Room"}, nil
}

/* ── rooms for guests (website & WhatsApp) ───────────────────────────── */

// PublicRoom is a room a guest may choose for a slot.
type PublicRoom struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Capacity    int     `json:"capacity"`
	PriceIDR    float64 `json:"price_idr"`
	Description string  `json:"description"`
}

// PublicRoomsAt lists the outlet's active rooms with room for people more
// guests during [start, end).
func (s *Service) PublicRoomsAt(ctx context.Context, branchID string, start, end time.Time, people int) ([]PublicRoom, error) {
	if _, err := s.publicOutlet(ctx, s.db, branchID); err != nil {
		return nil, err
	}
	if people < 1 {
		people = 1
	}
	rooms, err := s.st.rooms(ctx, s.db, branchID, true)
	if err != nil {
		return nil, err
	}
	out := []PublicRoom{}
	for _, r := range rooms {
		if r.Capacity < people {
			continue
		}
		n, _, err := s.st.roomUse(ctx, s.db, r.ID, "", start, end)
		if err != nil {
			return nil, err
		}
		if n+people > r.Capacity {
			continue
		}
		out = append(out, PublicRoom{ID: r.ID, Name: r.Name, Category: r.Category, Capacity: r.Capacity, PriceIDR: r.PriceIDR, Description: r.Description})
	}
	return out, nil
}

// PublicRooms is PublicRoomsAt for a single guest's treatments starting at startsAt.
func (s *Service) PublicRooms(ctx context.Context, branchID string, startsAt time.Time, variantIDs []string) ([]PublicRoom, error) {
	reqs := make([]itemRequest, len(variantIDs))
	for i, id := range variantIDs {
		reqs[i] = itemRequest{VariantID: id}
	}
	items, err := s.planItems(ctx, s.db, branchID, startsAt, reqs)
	if err != nil {
		return nil, err
	}
	end := startsAt
	for _, it := range items {
		end = end.Add(time.Duration(it.Variant.DurationMin) * time.Minute)
	}
	return s.PublicRoomsAt(ctx, branchID, startsAt, end, 1)
}
