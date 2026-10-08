import { afterEach, describe, expect, it, vi } from "vitest";
import { callPage, envelopeError, spaApi, withQuery } from "./api";

describe("withQuery", () => {
  it("membuang nilai kosong", () => {
    expect(withQuery("/api/spa/bookings", { branch_id: "b1", q: "", status: undefined, page: 2 })).toBe(
      "/api/spa/bookings?branch_id=b1&page=2"
    );
    expect(withQuery("/x")).toBe("/x");
  });
});

describe("envelopeError", () => {
  it("membaca error string atau {message}", () => {
    expect(envelopeError({ success: false, error: "Terapis bentrok dengan SPA-001" }, 409)).toBe(
      "Terapis bentrok dengan SPA-001"
    );
    expect(envelopeError({ error: { message: "Tidak valid" } }, 400)).toBe("Tidak valid");
    expect(envelopeError({}, 500)).toBe("Permintaan gagal (500)");
    expect(envelopeError({}, 403)).toBe("Anda tidak memiliki akses");
  });
});

describe("fetch wrapper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mengembalikan data + pagination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, data: [{ id: "1" }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }))
      )
    );
    await expect(callPage("/api/spa/bookings")).resolves.toEqual({
      data: [{ id: "1" }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it("melempar pesan server saat success=false walau HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "Gagal" }))));
    await expect(spaApi.outlets()).rejects.toThrow("Gagal");
  });

  it("mengirim aksi item sebagai PATCH JSON", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ success: true, data: { id: "b" } })));
    vi.stubGlobal("fetch", fetchMock);
    await spaApi.itemAction("b", "i", { action: "assign", therapist_id: "t" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/spa/bookings/b/items/i");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ action: "assign", therapist_id: "t" });
  });
});
