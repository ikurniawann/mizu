import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { parseContractTab } from "@/lib/hris/contract-tabs";
import { NoContractTable } from "./contract-reminder-tables";

afterEach(cleanup);

const rows = Array.from({ length: 20 }, (_, i) => ({
  employee_id: `e${i}`,
  employee_name: i === 3 ? "Siti Nurjanah" : `Karyawan ${i}`,
  employment_status: i % 2 ? "probation" : "freelance",
  join_date: "2026-03-01",
  draft_contract_number: i === 0 ? "0001/PKWT/X/2026" : null,
  draft_start_date: null,
}));

it("pages the employees without an active contract and searches by name", () => {
  render(<NoContractTable rows={rows} loading={false} />);
  expect(screen.getAllByRole("row")).toHaveLength(16); // header + 15
  expect(screen.getByText("Halaman 1 dari 2 · 20 karyawan")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Aktifkan draft" }).getAttribute("href")).toBe(
    "/dashboard/employees/e0?tab=contracts"
  );
  expect(screen.getAllByRole("link", { name: "Buat kontrak" }).length).toBe(14);
  expect(screen.getAllByText("Freelance").length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
  expect(screen.getAllByRole("row")).toHaveLength(6);

  fireEvent.change(screen.getByPlaceholderText("Cari nama karyawan..."), { target: { value: "siti" } });
  fireEvent.click(screen.getByRole("button", { name: "Terapkan" }));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Siti Nurjanah")).toBeTruthy();
});

it("shows an empty state", () => {
  render(<NoContractTable rows={[]} loading={false} />);
  expect(screen.getByText("Semua karyawan aktif sudah punya kontrak aktif.")).toBeTruthy();
});

it("reads the tab from the query string", () => {
  expect(parseContractTab("tanpa-kontrak")).toBe("tanpa-kontrak");
  expect(parseContractTab(["masa-percobaan"])).toBe("masa-percobaan");
  expect(parseContractTab("lain")).toBe("akan-berakhir");
  expect(parseContractTab(undefined)).toBe("akan-berakhir");
});
