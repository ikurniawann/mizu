import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExpiringContractsData } from "../api";
import { ContractExpiryBanner } from "./contract-expiry-banner";

const { data } = vi.hoisted(() => ({ data: { current: null as ExpiringContractsData | null } }));
vi.mock("../queries", () => ({ useExpiringContracts: () => ({ data: data.current }) }));

afterEach(cleanup);

const contract = (id: string, days: number): ExpiringContractsData["contracts"][number] => ({
  contract_id: id, employee_id: `e-${id}`, employee_name: `Karyawan ${id}`, contract_number: `${id}/PKWT/X/2026`,
  contract_type: "pkwt", position_title: null, end_date: "2026-11-01", days_left: days,
});

it("shows one compact card per reminder that links to its table", () => {
  data.current = {
    days: 30,
    probations: [],
    contracts: [contract("1", -2), contract("2", 10), contract("3", 25)],
    noContract: Array.from({ length: 108 }, (_, i) => ({
      employee_id: `n${i}`, employee_name: `Tanpa ${i}`, employment_status: "probation",
      join_date: null, draft_contract_number: null, draft_start_date: null,
    })),
  };
  render(<ContractExpiryBanner />);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(2);
  expect(links[0].getAttribute("href")).toBe("/dashboard/hris/contracts?tab=tanpa-kontrak");
  expect(links[0].textContent).toContain("108");
  expect(links[1].getAttribute("href")).toBe("/dashboard/hris/contracts?tab=akan-berakhir");
  expect(links[1].textContent).toContain("2 dalam 14 hari atau sudah lewat");
  // Tidak ada daftar nama di kartu.
  expect(screen.queryByText("Tanpa 0")).toBeNull();
  expect(screen.queryByText("Karyawan 1")).toBeNull();
});

it("carries the origin page for the breadcrumb", () => {
  data.current = { days: 30, contracts: [contract("1", 5)], probations: [], noContract: [] };
  render(<ContractExpiryBanner from="karyawan" />);
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/dashboard/hris/contracts?tab=akan-berakhir&from=karyawan"
  );
  fireEvent.click(screen.getByRole("link"));
  expect(window.sessionStorage.getItem("nav-from")).toBe("karyawan");
});

it("renders nothing without reminders", () => {
  data.current = { days: 30, contracts: [], probations: [], noContract: [] };
  const { container } = render(<ContractExpiryBanner />);
  expect(container.innerHTML).toBe("");
});
