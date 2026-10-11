import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spaKeys } from "../query-keys";
import type { Outlet, PriceInput, Treatment } from "../types";
import { SpaTreatmentsPage } from "./treatments-page";

const catalog: Treatment[] = [
  { id: "t2", code: "REF", name: "Refleksi", category: "Reflexology", description: null, is_active: false, sort_order: 0,
    variants: [{ id: "v3", name: "30 menit", duration_min: 30, price_idr: 100000, is_active: false, sort_order: 0, outlet_prices: [] }] },
  { id: "t1", code: "BAL", name: "Balinese Massage", category: "Massage", description: null, is_active: true, sort_order: 99,
    variants: [
      { id: "v2", name: "90 menit", duration_min: 90, price_idr: 300000, is_active: true, sort_order: 1, outlet_prices: [] },
      { id: "v1", name: "60 menit", duration_min: 60, price_idr: 200000, is_active: true, sort_order: 0, outlet_prices: [{ branch_id: "b1", price_idr: 220000 }] },
    ] },
];
const outlet = (branch_id: string, branch_name: string, configured = true): Outlet => ({
  branch_id, branch_name, configured, company_id: "c1", warehouse_id: null, warehouse_name: null,
  open_time: "10:00", close_time: "22:00", slot_minutes: 30, public_booking: true, is_active: branch_id !== "b2", warehouses: [],
});
let data: Treatment[];
let writes: { id: string; prices: PriceInput[] }[];
let failTreatment: string | null;
let failRead: boolean;
let releaseWrite: (() => void) | undefined;
let clients: QueryClient[];

beforeEach(() => {
  data = structuredClone(catalog);
  writes = [];
  clients = [];
  failTreatment = null;
  failRead = false;
  releaseWrite = undefined;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/treatment-categories")) return new Response(JSON.stringify({ success: true, data: [
      { id: "c1", name: "Massage", treatment_count: 1 },
      { id: "c2", name: "Reflexology", treatment_count: 1 },
    ] }));
    if (init?.method === "PUT") {
      const id = url.split("/").at(-2)!;
      const { prices } = JSON.parse(String(init.body)) as { prices: PriceInput[] };
      writes.push({ id, prices });
      if (releaseWrite) await new Promise<void>((resolve) => { releaseWrite = resolve; });
      if (id === failTreatment) return new Response(JSON.stringify({ success: false, error: { message: "Outlet di luar akses Anda" } }), { status: 403 });
      const treatment = data.find((t) => t.id === id)!;
      for (const p of prices) {
        const variant = treatment.variants.find((v) => v.id === p.variant_id)!;
        variant.outlet_prices = variant.outlet_prices.filter((existing) => existing.branch_id !== p.branch_id);
        if (p.price_idr !== null) variant.outlet_prices.push({ branch_id: p.branch_id, price_idr: p.price_idr });
      }
      return new Response(JSON.stringify({ success: true, data: treatment }));
    }
    if (failRead) return new Response(JSON.stringify({ success: false, error: "Penyegaran gagal" }), { status: 500 });
    return new Response(JSON.stringify({ success: true, data: url.endsWith("/outlets")
      ? [outlet("b1", "Mizu 1"), outlet("b2", "Mizu 2"), outlet("b3", "Belum dikonfigurasi", false)] : data }));
  });
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); vi.unstubAllGlobals(); });

async function openPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><SpaTreatmentsPage /></QueryClientProvider>);
  await screen.findAllByRole("button", { name: "Ubah" });
  return client;
}
const openPrices = () => fireEvent.click(screen.getByRole("tab", { name: "Harga Outlet" }));
const price = (variant: string, branch = "Mizu 1", treatment = "Balinese Massage") => screen.getByRole("textbox", { name: `Harga ${treatment}, ${variant}, ${branch}` });
const change = (variant: string, value: string, branch = "Mizu 1", treatment = "Balinese Massage") => fireEvent.change(price(variant, branch, treatment), { target: { value } });

describe("Treatment dan Harga Outlet", () => {
  it("mengurutkan A–Z, mengelompokkan varian, dan membuka harga lewat tab", async () => {
    await openPage();
    expect(screen.getByRole("tab", { name: "Daftar Treatment" })).toHaveAttribute("aria-selected", "true");
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Balinese Massage");
    expect(within(rows[1]).queryByRole("button", { name: "Harga per outlet" })).not.toBeInTheDocument();
    openPrices();
    expect(screen.getByRole("textbox", { name: "Cari treatment" })).toHaveValue("");
    fireEvent.click(screen.getByRole("tab", { name: "Daftar Treatment" }));
    fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Ubah" }));
    expect(screen.getByRole("combobox", { name: "Kategori" })).toHaveValue("Massage");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    openPrices();
    expect(screen.getByRole("columnheader", { name: "Harga berlaku (Rp)" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Harga outlet (Rp)" })).not.toBeInTheDocument();
    expect(price("60 menit")).toHaveValue("220.000");
    expect(price("90 menit")).toHaveValue("300.000");
    const priceRow = price("60 menit").closest("tr")!;
    expect(within(priceRow).getAllByRole("cell")[1]).toHaveTextContent(/^200\.000$/);
    expect(within(priceRow).queryByText("Harga khusus")).not.toBeInTheDocument();
    expect(within(price("90 menit").closest("tr")!).queryByText("Harga dasar")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: /^Harga / }).map((input) => input.getAttribute("aria-label"))).toEqual([
      "Harga Balinese Massage, 60 menit, Mizu 1", "Harga Balinese Massage, 90 menit, Mizu 1", "Harga Refleksi, 30 menit, Mizu 1",
    ]);
    expect(screen.queryByRole("option", { name: "Belum dikonfigurasi" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Mizu 2.*nonaktif/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buka Outlet Spa" })).toHaveAttribute("target", "_blank");
    fireEvent.change(screen.getByRole("combobox", { name: "Kategori" }), { target: { value: "Reflexology" } });
    fireEvent.click(screen.getByRole("tab", { name: "Daftar Treatment" }));
    openPrices();
    expect(price("30 menit", "Mizu 1", "Refleksi")).toBeInTheDocument();
  });

  it("mempertahankan draft lintas tab/outlet/filter/penyegaran dan menyimpan semua perubahan tersembunyi", async () => {
    const client = await openPage();
    openPrices();
    change("60 menit", "");
    expect(price("60 menit")).toHaveValue("200.000");
    fireEvent.change(screen.getByRole("combobox", { name: "Outlet" }), { target: { value: "b2" } });
    change("90 menit", "0", "Mizu 2");
    fireEvent.click(screen.getByRole("tab", { name: "Daftar Treatment" }));
    openPrices();
    expect(price("90 menit", "Mizu 2")).toHaveValue("0");
    await act(() => client.invalidateQueries({ queryKey: spaKeys.treatmentsAll() }));
    expect(price("90 menit", "Mizu 2")).toHaveValue("0");
    fireEvent.change(screen.getByRole("textbox", { name: "Cari treatment" }), { target: { value: "  ref  " } });
    fireEvent.change(screen.getByRole("combobox", { name: "Kategori" }), { target: { value: "Reflexology" } });
    expect(screen.queryByRole("textbox", { name: /^Harga Balinese/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 perubahan di 2 outlet belum disimpan")).toBeInTheDocument();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Simpan perubahan" })).toBeDisabled());
    expect(writes).toEqual([{ id: "t1", prices: [
      { variant_id: "v2", branch_id: "b2", price_idr: 0 },
      { variant_id: "v1", branch_id: "b1", price_idr: null },
    ] }]);
    expect(data[1].variants.find((v) => v.id === "v1")?.price_idr).toBe(200000);
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });

  it("menolak seluruh simpan jika draft tersembunyi tidak valid; nol di depan tidak berubah", async () => {
    await openPage(); openPrices();
    change("60 menit", "0220000");
    expect(screen.getByRole("button", { name: "Simpan perubahan" })).toBeDisabled();
    change("90 menit", "1000000000000");
    expect(price("90 menit")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "Outlet" }), { target: { value: "b2" } });
    change("60 menit", "250000", "Mizu 2");
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/tidak valid/i);
    expect(writes).toEqual([]);
  });

  it("mempertahankan draft gagal dan hanya mengirim sisanya saat mencoba lagi", async () => {
    await openPage(); openPrices();
    change("60 menit", "250.000");
    expect(price("60 menit")).toHaveValue("250.000");
    change("30 menit", "50000", "Mizu 1", "Refleksi");
    failTreatment = "t2";
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("1 perubahan sudah tersimpan"));
    expect(screen.getByRole("alert")).toHaveTextContent("Outlet di luar akses Anda");
    expect(screen.getByText("1 perubahan di 1 outlet belum disimpan")).toBeInTheDocument();
    expect(writes[0].prices).toEqual([{ variant_id: "v1", branch_id: "b1", price_idr: 250000 }]);
    expect(price("30 menit", "Mizu 1", "Refleksi")).toHaveValue("50.000");
    failTreatment = null;
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Simpan perubahan" })).toBeDisabled());
    expect(writes.map((request) => request.id)).toEqual(["t1", "t2", "t2"]);
  });

  it("mengunci input dan mencegah pengiriman ganda selama simpan", async () => {
    await openPage(); openPrices();
    change("60 menit", "250000");
    releaseWrite = () => {};
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(price("60 menit")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Menyimpan…" })).toBeDisabled();
    await act(async () => releaseWrite?.());
    await waitFor(() => expect(screen.getByRole("button", { name: "Simpan perubahan" })).toBeDisabled());
  });

  it("mempertahankan editor saat penyegaran gagal dan memblokir editor saat gagal pertama", async () => {
    const client = await openPage(); openPrices(); change("60 menit", "250000");
    failRead = true;
    await act(() => client.invalidateQueries({ queryKey: spaKeys.treatmentsAll() }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Penyegaran gagal");
    expect(price("60 menit")).toHaveValue("250.000");
    cleanup(); client.clear();
    render(<QueryClientProvider client={client}><SpaTreatmentsPage /></QueryClientProvider>);
    await screen.findByRole("alert"); openPrices();
    expect(screen.queryByRole("textbox", { name: /^Harga / })).not.toBeInTheDocument();
  });
});
