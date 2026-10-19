import { expect, it } from "vitest";
import {
  DEFAULT_EMPLOYEE_DIRECTORY_FILTERS,
  DEFAULT_USER_LIST_FILTERS,
  countActiveFilters,
} from "./users-list-filters";

it("opens the employee directory on active employees without counting it as a filter", () => {
  expect(DEFAULT_EMPLOYEE_DIRECTORY_FILTERS.active).toBe("true");
  expect(countActiveFilters(DEFAULT_EMPLOYEE_DIRECTORY_FILTERS, DEFAULT_EMPLOYEE_DIRECTORY_FILTERS)).toBe(0);
  // Pilih "All" di Karyawan = menyimpang dari bawaan → terhitung filter.
  expect(
    countActiveFilters({ ...DEFAULT_EMPLOYEE_DIRECTORY_FILTERS, active: "all" }, DEFAULT_EMPLOYEE_DIRECTORY_FILTERS)
  ).toBe(1);
  // Manajemen User tetap semua status.
  expect(DEFAULT_USER_LIST_FILTERS.active).toBe("all");
  expect(countActiveFilters({ ...DEFAULT_USER_LIST_FILTERS, active: "true", role: "admin" })).toBe(2);
});
