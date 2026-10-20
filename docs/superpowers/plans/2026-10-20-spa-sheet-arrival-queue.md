# Spa Sheet Arrival Queue Implementation Plan

> **For agentic workers:** Implement task-by-task with focused tests, then verify the integrated flow. Do not deploy until implementation is reviewed.

**Goal:** Merge the arrival queue into Spa Book Order Sheet while keeping columns fixed by check-in time and applying rotation only to automatic assignment.

**Architecture:** Reuse the existing arrival queue query for two distinct views: immutable-looking column order derived from `clock_in`, and live assignment priority from `position`. Add a single-booking auto-assignment API that shares the existing batch selection logic. Route DnD based on the booking's current assignment; preserve existing manual create, move, reschedule, and unassign behavior.

**Tech Stack:** Go Spa service/API, PostgreSQL attendance and booking tables, Next.js/React Query, Vitest and Go integration tests.

**Spec:** [Spa Sheet + antrean check-in — desain](../specs/2026-10-20-spa-sheet-arrival-queue-design.md)

## Global Constraints

- No schema migration or new dependency; reuse existing arrival and assignment data.
- The server is authoritative for eligibility, queue priority, conflict checks, and transaction boundaries.
- A DnD from Belum ditugaskan affects only its source booking, and succeeds only on the first eligible priority column.
- A DnD between therapist columns and create on a cell remain explicit manual choices.
- Preserve unrelated dirty worktree changes; stage only files involved in this feature if committing later.

## Review Focus

- No checked-in therapist: single-booking auto action returns a specific conflict, leaves booking untouched, and Sheet explains why.
- First queue candidate unavailable due to shift, leave, gender, or overlap: choose the next eligible candidate; if none, leave booking untouched.
- Stale browser queue or concurrent assignment: server rechecks inside the booking transaction and never assigns two therapists to the same booking.
- Outlet/date switch: never use arrival data from the prior query to order columns or show priority badges.
- Manual move, same-column reschedule, and unassign: preserve their existing semantics and validation.

---

### Task 1: Single-booking automatic assignment on the server

**Files:**

- Modify: `backend/internal/modules/spa/queue.go` — extract per-booking queue selection from the existing batch loop into a reusable transactional operation.
- Modify: `backend/internal/modules/spa/http_queue.go` — handler for `POST /api/spa/bookings/{id}/auto-assign`.
- Modify: `backend/internal/modules/spa/http.go` — register route under `iam.SpaBookings`.
- Test: `backend/internal/modules/spa/queue_integration_test.go`.

**Interface:** `Service.AutoAssignBooking(ctx context.Context, userID, bookingID, targetTherapistID string) (*AutoAssigned, error)` returns the booking and chosen therapist identifiers/names. A booking not currently unassigned, with no eligible checked-in therapist, or dropped onto a nonpriority therapist returns HTTP 409; unexpected DB errors propagate. Keep the existing `POST /api/spa/auto-assign` response shape and batch behavior unchanged. The shared automatic picker must check `Rosters` for `OnLeave`/`DayOff` before `checkBookingTherapist`, because that existing manual validation does not reject leave or day off.

- [ ] Add integration cases in `TestAutoAssignSingleBooking`: request assigns only the specified booking; wrong target returns 409 without mutation and names the priority therapist; unavailable first candidate is skipped; no check-in or changed status returns 409 without mutation; subsequent manual assignment influences queue priority.
- [ ] Run `go -C backend test ./internal/modules/spa -run 'TestAutoAssignSingleBooking' -count=1` and confirm the new cases fail for the missing route/behavior.
- [ ] Implement the route and shared selection using the existing booking lock, `arrivalQueueIn`, `checkBookingTherapist`, and `assignBooking` in one transaction; derive branch/date from the locked booking, not client input.
- [ ] Run `go -C backend test ./internal/modules/spa -run 'TestAutoAssignSingleBooking|TestArrivalQueueAssignsInClockInOrderWithRotation' -count=1` and confirm both focused tests pass.

### Task 2: Show check-in order and live priority in Sheet

**Files:**

- Modify: `frontend/src/features/spa/components/book-order-page.tsx` — load arrival queue for the selected outlet/date, sort the board's therapist rows, move queue controls into Sheet, remove Antrian tab.
- Modify: `frontend/src/features/spa/components/book-order-calendar.tsx` — show `clock_in`, live `position`, and absent status in lane headers.
- Modify: `frontend/src/features/spa/components/arrival-queue.tsx` — reshape the existing queue UI into a compact Sheet summary and preserve its batch action.
- Test: `frontend/src/features/spa/components/book-order-calendar.test.tsx` and a focused page test if the sort is tested at page level.

**Interface:** The Sheet receives queue metadata keyed by therapist ID. Present lanes sort by `clock_in` ascending, then ID; absent lanes follow by name, then ID. `position` is displayed but never used for lane ordering. If arrival data is loading or mismatched to the current outlet/date, retain board order without showing stale priority information.

- [ ] Add cases for A–B–C check-in order, rotation changing priority but not lane order, absent therapists last, and new check-in joining according to clock-in time.
- [ ] From `frontend/`, run `node node_modules/vitest/vitest.mjs run src/features/spa/components/book-order-calendar.test.tsx` and confirm the new cases fail on the current Sheet.
- [ ] Implement Sheet ordering and header badges; place queue summary/batch action within Sheet and remove its separate tab.
- [ ] Run focused Vitest and `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`.

### Task 3: Route DnD by assignment state and refresh both views

**Files:**

- Modify: `frontend/src/features/spa/api.ts` and `frontend/src/features/spa/types.ts` — single-booking auto-assign client/response.
- Modify: `frontend/src/features/spa/mutations.ts` — mutation invalidating booking, board, and arrival queue after automatic or manual assignment.
- Modify: `frontend/src/features/spa/components/use-booking-dnd.tsx` — unassigned-to-lane sends the target ID for priority validation; assigned-to-other-lane stays manual.
- Modify: `frontend/src/features/spa/components/book-order-calendar.tsx` — label the drop behavior explicitly so a column is not mistaken for a manual selection.
- Test: `frontend/src/features/spa/components/book-order-calendar.test.tsx` and `frontend/src/features/spa/api.test.ts` where API wiring is covered.

**Interface:** `spaApi.autoAssignBooking(bookingId, therapistId)` calls `POST /api/spa/bookings/{id}/auto-assign` with `therapist_id`. DnD from an unassigned card succeeds only if that target matches the latest first eligible queue candidate; otherwise the server error names the priority therapist. Assigned-to-other-lane uses existing `PUT /api/spa/bookings/{id}/therapist`; same-lane reschedule and drop-back unassign are unchanged.

- [ ] Change the DnD test to send the target therapist ID for server validation; add regression cases for manual lane-to-lane move, same-lane reschedule, unassign, and server conflict message.
- [ ] Run the focused calendar test file and confirm the changed DnD case fails.
- [ ] Implement API, mutation, DnD routing, explanatory copy, and query invalidation.
- [ ] Run focused Vitest, TypeScript typecheck, and the Go integration tests from Task 1; manually verify the acceptance sequence with three checked-in therapists before any deploy.
