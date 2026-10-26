package spa

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
)

// workingRosters requires starting within the original shift, while allowing
// treatment to finish up to an hour later. The preceding work date also matters
// for shifts crossing midnight. Point-in-time queue checks retain the original end.
func (s *Service) workingRosters(ctx context.Context, q Q, employees []string, iv domain.Interval) (map[string]Roster, error) {
	working, _, err := s.checkWorkingRosters(ctx, q, employees, iv)
	return working, err
}

// checkWorkingRosters also retains a useful rejection reason for explicit
// assignments; availability lists only need the matching roster set.
func (s *Service) checkWorkingRosters(ctx context.Context, q Q, employees []string, iv domain.Interval) (map[string]Roster, map[string]error, error) {
	out := map[string]Roster{}
	rejected := map[string]error{}
	if len(employees) == 0 {
		return out, rejected, nil
	}
	for _, day := range []time.Time{iv.Start, iv.Start.AddDate(0, 0, -1)} {
		date := domain.WIBDate(day)
		rosters, err := s.ports.People.Rosters(ctx, q, employees, date)
		if err != nil {
			return nil, nil, err
		}
		for id, r := range rosters {
			if r.OnLeave || r.DayOff || r.Shift == nil {
				continue
			}
			window := shiftInterval(date, r.Shift.StartTime, r.Shift.EndTime)
			if err := domain.WithinTreatmentShift(iv, window); err != nil {
				// Prefer today's shift, unless the visit starts within a preceding
				// day's overnight shift and only its completion exceeds the limit.
				if date == domain.WIBDate(iv.Start) || (!iv.Start.Before(window.Start) && iv.Start.Before(window.End)) {
					rejected[id] = err
				}
				continue
			}
			out[id] = r
		}
	}
	return out, rejected, nil
}
