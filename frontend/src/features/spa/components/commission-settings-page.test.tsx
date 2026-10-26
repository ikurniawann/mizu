import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommissionSettingsPage, MyCommissionRates } from "./commission-settings-page";
import { commissionChanges, type CommissionSetting } from "../commission-settings";

const rows: CommissionSetting[] = [
  { variant_id: "v1", treatment_name: "Massage", variant_name: "60 menit", duration_min: 60, is_active: true, values: [10000, 20000, 30000] },
  { variant_id: "v2", treatment_name: "Massage", variant_name: "90 menit", duration_min: 90, is_active: true, values: [null, null, null] },
];
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });
function mount(canUpdate = true) {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") writes.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ success: true, data: rows }));
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><CommissionSettingsPage canUpdate={canUpdate} /></QueryClientProvider>);
  return writes;
}
describe("Pengaturan Komisi", () => {
  it("mengirim matriks tiga level tanpa outlet termasuk draft tersembunyi", async () => {
    const writes = mount();
    const input = await screen.findByRole("spinbutton", { name: "Massage, 60 menit, Level 1" });
    fireEvent.change(input, { target: { value: "25000" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Cari treatment atau varian" }), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan komisi" }));
    await waitFor(() => expect(writes).toEqual([{ rows: [{ variant_id: "v1", values: [10000, 25000, 30000] }] }]));
    expect(screen.queryByRole("combobox", { name: /outlet/i })).not.toBeInTheDocument();
  });
  it("membedakan belum diatur dan nol serta memvalidasi ketiga level", async () => {
    const writes = mount();
    const input = await screen.findByRole("spinbutton", { name: "Massage, 90 menit, Level 0" });
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan komisi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ketiga level");
    expect(writes).toEqual([]);
    expect(commissionChanges(rows, { v2: ["0", "0", "0"] })).toEqual([{ variant_id: "v2", values: [0, 0, 0] }]);
    expect(() => commissionChanges(rows, { v1: ["-1", "2", "3"] })).toThrow();
    expect(() => commissionChanges(rows, { v1: ["1.5", "2", "3"] })).toThrow();
  });
  it("hak baca tidak menampilkan simpan dan tidak bisa mengubah tarif", async () => {
    mount(false);
    expect(await screen.findByRole("spinbutton", { name: "Massage, 60 menit, Level 0" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Simpan komisi" })).not.toBeInTheDocument();
  });
  it("menampilkan tarif level sendiri dan belum diatur", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: { level: 1, rates: [{ variant_id: "v2", treatment_name: "Massage", variant_name: "90 menit", value: null }] } })));
    client = new QueryClient();
    render(<QueryClientProvider client={client}><MyCommissionRates /></QueryClientProvider>);
    expect(await screen.findByText("Tarif komisi saya · Level 1")).toBeInTheDocument();
    expect(screen.getByText("Belum diatur")).toBeInTheDocument();
  });
});
