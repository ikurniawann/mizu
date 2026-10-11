import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaTreatmentCategoriesPage } from "./treatment-categories-page";

let categories: { id: string; name: string; treatment_count: number }[];
let client: QueryClient;

beforeEach(() => {
  categories = [{ id: "c1", name: "Massage", treatment_count: 1 }];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const { name } = JSON.parse(String(init?.body));
      const category = { id: "c2", name, treatment_count: 0 };
      categories.push(category);
      return new Response(JSON.stringify({ success: true, data: category }));
    }
    if (method === "PATCH") {
      const category = categories.find((item) => url.endsWith(item.id))!;
      category.name = JSON.parse(String(init?.body)).name;
      return new Response(JSON.stringify({ success: true, data: category }));
    }
    if (method === "DELETE") {
      categories = categories.filter((item) => !url.endsWith(item.id));
      return new Response(JSON.stringify({ success: true, data: {} }));
    }
    return new Response(JSON.stringify({ success: true, data: categories.map((item) => ({ ...item })) }));
  });
});

afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it("menambah, mengubah, dan menghapus kategori kosong; kategori terpakai terlindungi", async () => {
  render(<QueryClientProvider client={client}><SpaTreatmentCategoriesPage /></QueryClientProvider>);
  const massage = await screen.findByRole("row", { name: /Massage/ });
  expect(within(massage).getByRole("button", { name: "Hapus" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Kategori baru" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nama kategori" }), { target: { value: "Facial" } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
  const facial = await screen.findByRole("row", { name: /Facial/ });
  fireEvent.click(within(facial).getByRole("button", { name: "Ubah" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nama kategori" }), { target: { value: "Body Treatment" } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
  const renamed = await screen.findByRole("row", { name: /Body Treatment/ });
  fireEvent.click(within(renamed).getByRole("button", { name: "Hapus" }));
  fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
  await waitFor(() => expect(screen.queryByRole("row", { name: /Body Treatment/ })).not.toBeInTheDocument());
});
