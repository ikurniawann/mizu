import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ContractExpiryBanner } from "./contract-expiry-banner";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../queries", () => ({
  useExpiringContracts: () => ({
    data: {
      days: 30,
      contracts: [],
      probations: [],
      noContract: [
        {
          employee_id: "employee-1",
          employee_name: "Ayu Lestari",
          employment_status: "pkwt",
          join_date: "2026-01-01",
          draft_contract_number: null,
          draft_start_date: null,
        },
        {
          employee_id: "employee-2",
          employee_name: "Budi Santoso",
          employment_status: "pkwtt",
          join_date: "2026-02-01",
          draft_contract_number: "PKWT-002",
          draft_start_date: "2026-02-01",
        },
      ],
    },
  }),
}));

it("keeps employees without contracts collapsed until their details are requested", () => {
  render(<ContractExpiryBanner />);

  expect(screen.getByText("2 karyawan aktif tanpa kontrak aktif")).toBeInTheDocument();
  const detailsTrigger = screen.getByRole("button", { name: /Lihat 2 karyawan/ });
  expect(detailsTrigger).toBeInTheDocument();
  expect(detailsTrigger.closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("link", { name: "Ayu Lestari" })).toHaveAttribute(
    "href",
    "/dashboard/employees/employee-1?tab=contracts"
  );
});
