import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PayrollRun } from "../types";
import { RunsTable } from "./runs-table";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(cleanup);

const run = (over: Partial<PayrollRun>): PayrollRun => ({
  id: "run-1",
  run_name: "Payroll Desember 2026",
  period_month: 12,
  period_year: 2026,
  status: "draft",
  total_employees: 3,
  total_gross: 1_000_000,
  total_net: 900_000,
  total_deductions: 100_000,
  created_at: "2026-10-16T00:00:00Z",
  company_id: "company-1",
  ...over,
});

function rowFor(name: RegExp) {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

it("offers Hitung, Process and Hapus on an entity draft", () => {
  render(<RunsTable runs={[run({})]} emptyText="kosong" onUpdateStatus={vi.fn()} onDelete={vi.fn()} />);
  const row = within(rowFor(/Desember 2026/));
  expect(row.getByRole("button", { name: "Hitung" })).toBeTruthy();
  expect(row.getByRole("button", { name: "Process" })).toBeTruthy();
  expect(row.getByRole("button", { name: "Hapus" })).toBeTruthy();
});

it("keeps combined drafts from being recalculated or processed", () => {
  render(<RunsTable runs={[run({ company_id: null })]} combined emptyText="kosong" onUpdateStatus={vi.fn()} onDelete={vi.fn()} />);
  const row = within(rowFor(/Desember 2026/));
  expect(row.queryByRole("button", { name: "Hitung" })).toBeNull();
  expect(row.queryByRole("button", { name: "Process" })).toBeNull();
  expect(row.getByRole("button", { name: "Hapus" })).toBeTruthy();
});

it("lets an in-flight combined run be finished but never deleted once paid", () => {
  render(
    <RunsTable
      runs={[
        run({ id: "a", company_id: null, status: "completed", period_month: 9, run_name: "Payroll September 2026" }),
        run({ id: "b", company_id: null, status: "paid", period_month: 8, run_name: "Payroll Agustus 2026" }),
      ]}
      combined
      emptyText="kosong"
      onUpdateStatus={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  expect(within(rowFor(/September 2026/)).getByRole("button", { name: "Mark Paid" })).toBeTruthy();
  expect(within(rowFor(/Agustus 2026/)).queryByRole("button", { name: "Hapus" })).toBeNull();
});

it("shows the run name only when it differs from the default", () => {
  render(
    <RunsTable
      runs={[run({}), run({ id: "c", period_month: 11, run_name: "Payroll November 2026 (koreksi)" })]}
      emptyText="kosong"
      onUpdateStatus={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  expect(screen.queryByText("Payroll Desember 2026")).toBeNull();
  expect(screen.getByText("Payroll November 2026 (koreksi)")).toBeTruthy();
});
