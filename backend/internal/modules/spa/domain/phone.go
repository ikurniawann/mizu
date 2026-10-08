package domain

import (
	"regexp"
	"strings"
)

var nonDigit = regexp.MustCompile(`\D`)

// NormalizePhone turns an Indonesian phone spelling into the local format
// POS customers are stored with (0812…, as member-portal's
// LocalPhoneFormat). It returns "" when the number is not 10–15 digits.
func NormalizePhone(raw string) string {
	digits := nonDigit.ReplaceAllString(raw, "")
	if strings.HasPrefix(digits, "0") {
		digits = "62" + digits[1:]
	}
	if len(digits) < 10 || len(digits) > 15 {
		return ""
	}
	if strings.HasPrefix(digits, "62") {
		return "0" + digits[2:]
	}
	return digits
}
