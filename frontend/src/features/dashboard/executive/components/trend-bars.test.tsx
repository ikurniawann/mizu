import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { niceCeiling, TrendBars } from "./trend-bars";

afterEach(cleanup);

const points = Array.from({ length: 14 }, (_, i) => ({
  tanggal: `2026-10-${String(i + 1).padStart(2, "0")}`,
  omzet: i >= 8 && i < 13 ? 0 : 1_000_000 + i * 250_000,
  pesanan: i >= 8 && i < 13 ? 0 : 10 + i,
}));

it("membulatkan skala ke angka rapi", () => {
  expect(niceCeiling(4_300_000)).toBe(5_000_000);
  expect(niceCeiling(2_100_000)).toBe(2_500_000);
  expect(niceCeiling(900)).toBe(1_000);
  expect(niceCeiling(5_600_000)).toBe(6_000_000);
  expect(niceCeiling(0)).toBe(1);
});

it("menampilkan 14 batang, titik untuk hari tanpa penjualan, dan label hari ini", () => {
  render(<TrendBars points={points} />);
  expect(screen.getAllByTestId("trend-bar")).toHaveLength(14);
  expect(screen.getAllByTestId("trend-empty")).toHaveLength(5);
  // Hari ini (14 Okt): 1.000.000 + 13 × 250.000 = Rp 4,25 jt, plus label skala Rp 5 jt.
  expect(screen.getByRole("img", { name: /hari ini Rp 4,25 jt/ })).toBeInTheDocument();
  expect(screen.getByText("Rp 5 jt")).toBeInTheDocument();
  expect(screen.getByText("Minggu ini")).toBeInTheDocument();
});

it("tooltip memuat omzet dan jumlah pesanan", () => {
  render(<TrendBars points={points} />);
  const bar = screen.getAllByTestId("trend-bar")[2];
  fireEvent.focus(bar);
  expect(bar).toHaveAccessibleName(/Rp 1\.500\.000, 12 pesanan/);
});
