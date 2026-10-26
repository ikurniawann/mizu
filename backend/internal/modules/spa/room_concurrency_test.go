package spa

import (
	"context"
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

func TestRoomGroupLocksInIDOrder(t *testing.T) {
	db := testutil.DB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	org := testutil.CreateOrg(t, nil)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	var ids []string
	for _, name := range []string{"A", "B"} {
		var id string
		must(db.QueryRow(ctx, `INSERT INTO spa.rooms(branch_id,name) VALUES($1,$2) RETURNING id::text`, org.BranchID, name).Scan(&id))
		ids = append(ids, id)
	}
	slices.Sort(ids)
	blocker, err := db.Begin(ctx)
	must(err)
	defer blocker.Rollback(context.Background())
	_, err = blocker.Exec(ctx, `SELECT id FROM spa.rooms WHERE id=$1 FOR NO KEY UPDATE`, ids[1])
	must(err)
	locker, err := db.Begin(ctx)
	must(err)
	defer locker.Rollback(context.Background())
	var pid int
	must(locker.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid))
	done := make(chan error, 1)
	go func() { done <- (store{}).lockRooms(ctx, locker, []string{ids[1], ids[0], ids[1]}) }()
	// Once blocked on the high ID, a correctly ordered request already owns
	// the low ID, even when the input lists the high ID first.
	for {
		var waiting bool
		must(db.QueryRow(ctx, `SELECT COALESCE(wait_event_type='Lock',false) FROM pg_stat_activity WHERE pid=$1`, pid).Scan(&waiting))
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	probe, err := db.Begin(ctx)
	must(err)
	defer probe.Rollback(context.Background())
	_, err = probe.Exec(ctx, `SELECT id FROM spa.rooms WHERE id=$1 FOR NO KEY UPDATE NOWAIT`, ids[0])
	if database.PgCode(err) != "55P03" {
		t.Errorf("lower room was not locked first: %v", err)
	}
	must(probe.Rollback(ctx))
	must(blocker.Rollback(ctx))
	must(<-done)
}

func TestRoomTransferConcurrentCapacity(t *testing.T) {
	for _, creating := range []bool{false, true} {
		name := "transfer"
		if creating {
			name = "create"
		}
		t.Run(name, func(t *testing.T) {
			db := testutil.DB(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			org := testutil.CreateOrg(t, nil)
			must := func(err error) {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
			}
			var room string
			must(db.QueryRow(ctx, `INSERT INTO spa.rooms(branch_id,name,capacity,price_idr) VALUES($1,'Last room',1,100000) RETURNING id::text`, org.BranchID).Scan(&room))
			var ids []string
			t.Cleanup(func() {
				_, _ = db.Exec(context.Background(), `DELETE FROM spa.bookings WHERE branch_id=$1`, org.BranchID)
				_, _ = db.Exec(context.Background(), `DELETE FROM spa.rooms WHERE id=$1`, room)
			})
			for i := 0; i < 2; i++ {
				var id string
				must(db.QueryRow(ctx, `INSERT INTO spa.bookings(booking_code,branch_id,warehouse_id,booking_type,customer_name,scheduled_at,ends_at,status)
				 VALUES($1,$2,(SELECT id FROM configuration.warehouses WHERE branch_id=$2 LIMIT 1),'walk_in','Concurrent',now(),now()+interval '1 hour','unassigned') RETURNING id::text`, "ROOM-"+testutil.RandomHex(5), org.BranchID).Scan(&id))
				ids = append(ids, id)
			}
			first, err := db.Begin(ctx)
			must(err)
			defer first.Rollback(context.Background())
			second, err := db.Begin(ctx)
			must(err)
			defer second.Rollback(context.Background())
			svc := &Service{}
			b1, err := svc.st.bookingRow(ctx, first, ids[0], true)
			must(err)
			b2, err := svc.st.bookingRow(ctx, second, ids[1], true)
			must(err)
			if !creating { // A transfer has an existing origin room.
				var origin string
				must(second.QueryRow(ctx, `INSERT INTO spa.rooms(branch_id,name) VALUES($1,'Origin') RETURNING id::text`, org.BranchID).Scan(&origin))
				must(svc.st.setBookingRoom(ctx, second, b2.ID, &origin, 0))
				b2.RoomID = &origin
			}
			must(svc.assignRoomIn(ctx, first, "", b1, room))
			done := make(chan error, 1)
			go func() { done <- svc.assignRoomIn(ctx, second, "", b2, room) }()
			select {
			case err := <-done:
				t.Fatalf("capacity check did not wait for room lock: %v", err)
			case <-time.After(150 * time.Millisecond):
			}
			must(first.Commit(ctx))
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("second booking exceeded room capacity")
				}
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			must(second.Rollback(ctx))
			var count int
			must(db.QueryRow(ctx, `SELECT count(*) FROM spa.bookings WHERE room_id=$1`, room).Scan(&count))
			if count != 1 {
				t.Fatalf("room holds %d bookings", count)
			}
		})
	}
}
