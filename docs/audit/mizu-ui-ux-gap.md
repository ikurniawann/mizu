# Mizu UI and UX gap review

## Booking flow

| Gap found | Effect on guests | Change |
| --- | --- | --- |
| The public time picker generated slots from opening hours alone. | Guests could choose a time with no free therapist and receive a late rejection. | The slot list now checks therapist availability and unassigned reservations. The booking write checks again under an outlet lock. |
| Treatment and outlet calls to action opened a blank booking flow. | Guests had to find the same choice again. | Booking links now carry the selected outlet and treatment into the wizard. |
| Confirmation lived only in the current browser state. | A refresh lost the booking details and code. | A private, shareable status link retrieves the booking and its current status. |
| Validation errors appeared only as a general message. | Guests had to guess which contact field needed fixing. | Name and phone errors appear beside their fields and move focus there. |
| Guests had to contact the outlet to cancel or change a booking. | A simple schedule change required staff help. | The status link now supports phone-verified cancellation and rescheduling until 24 hours before an unpaid visit. |
| The booking journey had no step-level measurement. | Staff could not see where guests stopped. | Anonymous step events feed a seven-stage report on the staff booking page. |

## Member experience

| Gap found | Effect on members | Change |
| --- | --- | --- |
| The web member booking area showed class reservations but no spa reservations. | Spa guests could not find their next visit after signing in. | The booking area now has treatment and class views, with upcoming and past spa reservations. |
| The mobile app used starter branding and did not show spa reservations. | The app did not look or behave like a Mizu member app. | Updated the app identity, colors, home screen, and booking list. The booking action opens the public site. |
| Light-theme login fields used hard-coded dark-theme colors. | Input text and controls could have poor contrast. | Login fields now use theme colors. |

## Rollout notes

- The new public booking token needs database migration `20261008110000_spa_public_booking_token.sql` before the status page can work.
- Phone verification and the funnel report need `20261008120000_spa_public_booking_management.sql` and a working WhatsApp OTP provider.
- Renamed historical migration files keep their original timestamps. The migration runner recognizes those timestamps in existing migration histories so they are not applied again.
- The mobile app needs `EXPO_PUBLIC_SITE_URL` set to the public Next.js origin on real devices. `EXPO_PUBLIC_API_URL` remains the member API origin.
- Existing external links and records containing the previous brand name are outside the repository and need a separate redirect or data migration if they must keep working.
