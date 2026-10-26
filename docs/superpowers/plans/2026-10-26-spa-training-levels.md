# Spa Training and Levels Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Training per periode, persetujuan admin, kenaikan level otomatis, dan reset setelah resign.
**Architecture:** Perluas modul Spa, gunakan HRIS employment_status sebagai sumber resign, trigger PostgreSQL untuk sinkronisasi siklus kerja, React Query untuk UI.
**Tech Stack:** Go, pgx, PostgreSQL, Next.js, React Query, Vitest.
**Spec:** [Desain](../specs/2026-10-26-spa-training-levels-design.md).

## Global Constraints
- Label Level 0/1/2; satu halaman Training dengan tab terpisah Pengaturan Level.
- Kelulusan final oleh admin, penilaian di luar aplikasi, akses sendiri terikat login.
- Nonaktif bukan resign; siklus kerja baru mengabaikan kelulusan lama.
- Tidak menambahkan dependensi, tidak mengubah komisi atau data operasional.

## Review Focus
- Persetujuan/pendaftaran bersamaan tidak menembus larangan duplikasi.
- Resign, status kerja baru, aktivasi terpisah tidak mengembalikan level lama.
- Syarat kosong dan kelulusan siklus lama tidak menaikkan level.
- Izin read tidak memberikan hak persetujuan, endpoint sendiri tidak membocorkan peserta lain.
- Aturan berubah tidak menurunkan level; training baru tetap membedakan periode.

## Tasks
- [x] 1. Tulis dan jalankan tes integrasi alur training/level (merah), dengan database uji terpisah.
  Files: `backend/internal/modules/spa/training_integration_test.go`.
  Contract: GET/POST `/api/spa/trainings`, GET/POST `/trainings/{id}/participants`, GET `/trainings/{id}/candidates`, POST `/training-participants/{id}/status`, GET/PUT `/level-requirements`, GET `/me/trainings`.
- [x] 2. Migrasi data, trigger HRIS, store/service/HTTP training dan evaluasi level.
  Files: `backend/database/migrations/deltas/20261026090000_spa_training_levels.sql`, `backend/internal/modules/spa/{training,postgres_training,http_training}.go`, `http.go`, `types.go`, `postgres.go`.
  Check: `TEST_DATABASE_URL=<scratch> go -C backend test ./internal/modules/spa/... ./internal/modules/hris/...`.
- [x] 3. Tes UI kemudian implementasi Training, Pengaturan Level, peserta dan Training Saya; level/status/filter pada daftar terapis.
  Files: `frontend/src/features/spa/training.ts`, `components/{training-page,training-detail,level-settings,my-training-page}.tsx`, route pages, `types.ts`, `components/therapists-page.tsx`.
  Check: `pnpm --dir frontend test src/features/spa` dan `pnpm --dir frontend exec tsc --noEmit`.
- [x] 4. Verifikasi regresi, review independen, dan dokumentasi penggunaan serta migrasi.
  Check: targeted backend integration, frontend tests/lint/typecheck, review and diff checks.

## Progress
- Initial: existing feature branch `feat/mizu-spa-booking`; working in current workspace. Scratch database mizu_training_test cloned from development database. No production writes.
- Task 1: API tests failed with 404 before implementation; migration and API implementation made them pass.
- Task 2: integration tests verify all-required/empty rules, approval idempotency, same-training prohibition, new-period allowance, rehire reset, staged status activation, cancellation of pending old-cycle participation, read-only permissions and self-service isolation.
- Task 3: 224 tests passed across Spa and backend route proxy; changed frontend files pass ESLint. Therapist fixtures updated for the expanded API contract.
- Ruling: move promotion evaluation into shared PostgreSQL function so temporary HRIS reactivation evaluates newly configured rules too. Rehire explicitly resets and does not auto-evaluate old-cycle passes.
- Review: independent reviewer found one concurrency bug: rule edits could miss a concurrent inactive→active HRIS transition. Added TestTrainingRulesConcurrentWithReactivation, observed Level 0 failure, then fixed by locking every therapist employee before evaluating current eligibility (including previously inactive rows). Test now passes. No other concrete findings.
- Verification: Go unit suite `go test ./...` passes (database integration skipped in this run). Spa/HRIS/app integration passes on scratch with pre-existing `TestCustomerReportUsesPaidPOSOrdersAndWIB` excluded: that fixture generates a 23-character phone for a varchar(20) column. The failure was observed in the unfiltered run.
- Typecheck: application sources have no reported errors after fixture updates. Standard `tsc --noEmit` remains blocked by existing generated `.next/types` errors for POS order status PATCH params and Purchasing layout sidebar; these unrelated files are unchanged.
- Scope: no production migration, deployment, commit or push. Unrelated untracked .idx-check and .vscode files left untouched. Generated proxy manifest updates limited to the new Spa routes; pre-existing stale POS parking manifest entries are outside this change.
- Final frontend suite: `pnpm --dir frontend run test --maxWorkers=4` → 745 files passed, 2 skipped; 5,454 tests passed, 10 skipped. One existing Vite warning for a dynamic Purchasing import; no test failures.
- Reviewer declined-to-judge rulings: browser rendering was not manually verified (React component tests cover the workflows); production rollout remains pending (migration and release order documented); real concurrency is verified by the new two-transaction integration test; existing unrelated integration/typecheck failures are recorded above. No deferred feature defects reported.
- Deployment follow-up (26 October 2026): user requested build and deployment. `tools/deploy-mizu.sh` completed with exit 0, release `local-20261026-013429`. Production database backed up before migration; training migration applied; schema verification reported 10,359 objects with zero missing/different/extra. Web and API containers healthy. Public login/readiness returned HTTP 200; unauthenticated training API returned HTTP 401. Training menus and lifecycle trigger verified in production. No commit or push performed.
