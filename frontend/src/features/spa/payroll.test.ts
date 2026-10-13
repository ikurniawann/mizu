import { expect, it } from "vitest";
import { payLineTotal } from "./payroll";

it("menjumlahkan gaji, tunjangan, komisi, bonus dikurangi potongan", () => {
  expect(payLineTotal({ base_salary_idr: 3_000_000, allowance_idr: 500_000, commission_idr: 20_000, bonus_idr: 100_000, deduction_idr: 50_000 })).toBe(3_570_000);
  expect(payLineTotal({ base_salary_idr: 0, allowance_idr: 0, commission_idr: 20_000, bonus_idr: 0, deduction_idr: 0 })).toBe(20_000);
});
