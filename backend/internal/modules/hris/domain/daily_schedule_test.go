package domain

import "testing"

func TestDailyScheduleWinsSameEffectiveDate(t *testing.T) {
	shift := "weekly"
	date := "2026-11-02"
	rows := []ScheduleRow{{DayOfWeek: 1, ShiftID: &shift, EffectiveFrom: date}, {DayOfWeek: 1, EffectiveFrom: date, EffectiveTo: &date}}
	if got := ResolveScheduleRow(rows, date); got != 1 {
		t.Fatalf("daily day off must win, index=%d", got)
	}
	if got := ResolveScheduleRow(rows, "2026-11-09"); got != 0 {
		t.Fatalf("weekly fallback lost: %d", got)
	}
}
