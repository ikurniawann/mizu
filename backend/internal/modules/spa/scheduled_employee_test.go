package spa_test

// Booking fixtures have an explicit work schedule. Tests for missing schedules
// continue to use employee(), so they cannot accidentally inherit availability.
func (e *env) scheduledEmployee(name string, userID *string) string {
	e.t.Helper()
	id := e.employee(name, userID)
	var shift string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.shifts(name,start_time,end_time) VALUES('Booking fixture','09:00','22:00') RETURNING id::text`).Scan(&shift); err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shifts(employee_id,day_of_week,shift_id,effective_from) SELECT $1,d,$2,'1900-01-01' FROM generate_series(1,7) d`, id, shift); err != nil {
		e.t.Fatal(err)
	}
	return id
}
