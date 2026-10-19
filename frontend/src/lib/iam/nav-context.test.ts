import { afterEach, expect, it } from "vitest";
import { NAV_FROM_EMPLOYEES, clearPersistedNavFrom, persistNavFrom, resolveNavFrom } from "./nav-context";

afterEach(clearPersistedNavFrom);

it("keeps the Karyawan origin only on its target page", () => {
  persistNavFrom(NAV_FROM_EMPLOYEES);
  expect(resolveNavFrom("/dashboard/hris/contracts", null)).toBe(NAV_FROM_EMPLOYEES);
  // Pindah ke halaman lain → asal dilupakan, tidak ikut ke Kontrak berikutnya.
  expect(resolveNavFrom("/dashboard/hris/payroll", null)).toBeNull();
  expect(resolveNavFrom("/dashboard/hris/contracts", null)).toBeNull();
  // Query ?from= tetap menang.
  expect(resolveNavFrom("/dashboard/hris/contracts", NAV_FROM_EMPLOYEES)).toBe(NAV_FROM_EMPLOYEES);
});
