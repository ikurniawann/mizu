import { describe, expect, it, vi } from "vitest";
import { confirmCode, confirmProblem, isPlausiblePhone, requestCode, safeReturnPath, type ConfirmInput } from "./member-auth";

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { path: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/member-portal", "");
    calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    const r = routes[path];
    if (!r) throw new Error(`unexpected ${path}`);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const google = { ticket: "t1", email: "ani@gmail.com", name: "Ani" };

describe("requestCode", () => {
  it("member lama: jalur masuk", async () => {
    const { fn, calls } = fakeFetch({ "/otp": { body: { success: true, wa_delivered: true } } });
    await expect(requestCode("0812", null, fn)).resolves.toEqual({ mode: "login", waDelivered: true, devBypass: false });
    expect(calls.map((c) => c.path)).toEqual(["/otp"]);
  });

  it("nomor baru: lanjut ke jalur daftar", async () => {
    const { fn, calls } = fakeFetch({
      "/otp": { status: 404, body: { success: false, code: "not_registered", error: "Nomor belum terdaftar" } },
      "/register/otp": { body: { success: true, wa_delivered: false } },
    });
    await expect(requestCode("0812", null, fn)).resolves.toMatchObject({ mode: "register", waDelivered: false });
    expect(calls.map((c) => c.path)).toEqual(["/otp", "/register/otp"]);
  });

  it("Google: langsung jalur daftar", async () => {
    const { fn, calls } = fakeFetch({ "/register/otp": { body: { success: true, wa_delivered: true } } });
    await expect(requestCode("0812", google, fn)).resolves.toMatchObject({ mode: "register" });
    expect(calls.map((c) => c.path)).toEqual(["/register/otp"]);
  });

  it("galat lain diteruskan (rate limit)", async () => {
    const { fn } = fakeFetch({ "/otp": { status: 429, body: { success: false, error: "Terlalu banyak permintaan" } } });
    await expect(requestCode("0812", null, fn)).rejects.toThrow("Terlalu banyak permintaan");
  });
});

describe("confirmCode", () => {
  const base: ConfirmInput = { mode: "login", phone: "0812", code: "123456", name: "", google: null, devBypass: false };

  it("validasi lokal", () => {
    expect(confirmProblem({ ...base, code: "12" })).toBe("Kode OTP harus 6 digit");
    expect(confirmProblem({ ...base, mode: "register", name: " " })).toBe("Isi nama lengkap");
    expect(confirmProblem({ ...base, code: "", devBypass: true })).toBeNull();
  });

  it("masuk lewat /verify", async () => {
    const { fn, calls } = fakeFetch({ "/verify": { body: { success: true } } });
    await confirmCode(base, fn);
    expect(calls[0]).toEqual({ path: "/verify", body: { phone: "0812", code: "123456" } });
  });

  it("daftar membawa tiket Google dan email", async () => {
    const { fn, calls } = fakeFetch({ "/register": { body: { success: true } } });
    await confirmCode({ ...base, mode: "register", name: " Ani ", google }, fn);
    expect(calls[0].body).toEqual({ phone: "0812", code: "123456", name: "Ani", email: "ani@gmail.com", google_ticket: "t1", wa_consent: false });
  });

  it("kode salah", async () => {
    const { fn } = fakeFetch({ "/verify": { status: 400, body: { success: false, error: "Kode salah" } } });
    await expect(confirmCode(base, fn)).rejects.toThrow("Kode salah");
  });
});

describe("helpers", () => {
  it("nomor masuk akal", () => {
    expect(isPlausiblePhone("0812-3456-789")).toBe(true);
    expect(isPlausiblePhone("0812")).toBe(false);
  });
  it("return path aman", () => {
    expect(safeReturnPath("/member/bookings", "/member")).toBe("/member/bookings");
    expect(safeReturnPath("//evil.com", "/member")).toBe("/member");
    expect(safeReturnPath("https://evil.com", "/member")).toBe("/member");
    expect(safeReturnPath(null, "/member")).toBe("/member");
  });
});
