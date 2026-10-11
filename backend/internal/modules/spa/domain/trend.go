package domain

import "fmt"

// TrendPeriods returns every calendar bucket intersecting the inclusive WIB
// range, without expanding the booking query's date bounds.
func TrendPeriods(from, to, interval string) ([]string, error) {
	start, end, ok := RangeBounds(from, to)
	if !ok {
		return nil, fmt.Errorf("Periode tidak valid")
	}
	years, months, days := 0, 0, 0
	switch interval {
	case "daily":
		days = 1
	case "monthly":
		start = start.AddDate(0, 0, 1-start.Day())
		months = 1
	case "yearly":
		start = start.AddDate(0, 1-int(start.Month()), 1-start.Day())
		years = 1
	default:
		return nil, fmt.Errorf("Kelompok periode harus daily, monthly, atau yearly")
	}
	periods := []string{}
	for d := start; d.Before(end); d = d.AddDate(years, months, days) {
		if len(periods) == 1000 {
			return nil, fmt.Errorf("Maksimal 1000 periode; perkecil rentang tanggal atau pilih kelompok periode lebih besar")
		}
		periods = append(periods, d.Format("2006-01-02"))
	}
	return periods, nil
}
