import { describe, expect, it, vi } from "vitest";
import {
  confirmCode,
  formatCountdown,
  formatNational,
  isValidName,
  isValidNational,
  MemberAuthError,
  nationalDigits,
  requestLoginCode,
  requestRegisterCode,
  safeReturnPath,
  toApiPhone,
  type ConfirmInput,
} from "./member-auth";

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

const notRegistered = { status: 404, body: { success: false, code: "not_registered", error: "Nomor belum terdaftar" } };
const google = { ticket: "t1", email: "ani@gmail.com", name: "Ani" };

describe("nomor HP", () => {
  it.each([
    ["0812-3456-7890", "81234567890"],
    ["+62 812 3456 7890", "81234567890"],
    ["6281234567890", "81234567890"],
    ["81234567890", "81234567890"],
  ])("nationalDigits(%s)", (input, want) => {
    expect(nationalDigits(input)).toBe(want);
  });

  it("format berkelompok & API", () => {
    expect(formatNational("81234567890")).toBe("812-3456-7890");
    expect(formatNational("8123")).toBe("812-3");
    expect(toApiPhone("0812-3456-7890")).toBe("+6281234567890");
  });

  it("validasi", () => {
    expect(isValidNational("81234567890")).toBe(true);
    expect(isValidNational("8123")).toBe(false);
    expect(isValidNational("21234567890")).toBe(false); // bukan seluler
    expect(isValidName(" A ")).toBe(false);
    expect(isValidName("Ani")).toBe(true);
  });
});

describe("kirim kode", () => {
  it("masuk: member lama", async () => {
    const { fn, calls } = fakeFetch({ "/otp": { body: { success: true, wa_delivered: true } } });
    await expect(requestLoginCode("81234567890", fn)).resolves.toMatchObject({ mode: "login", waDelivered: true });
    expect(calls[0].body).toEqual({ phone: "+6281234567890" });
  });

  it("masuk: nomor baru → not_registered", async () => {
    const { fn } = fakeFetch({ "/otp": notRegistered });
    const err = await requestLoginCode("81234567890", fn).catch((e) => e);
    expect(err).toBeInstanceOf(MemberAuthError);
    expect(err.reason).toBe("not_registered");
  });

  it("daftar: nomor baru → jalur daftar", async () => {
    const { fn, calls } = fakeFetch({ "/otp": notRegistered, "/register/otp": { body: { success: true } } });
    await expect(requestRegisterCode("81234567890", null, fn)).resolves.toMatchObject({ mode: "register", switchedToLogin: false });
    expect(calls.map((c) => c.path)).toEqual(["/otp", "/register/otp"]);
  });

  it("daftar: nomor sudah member → otomatis masuk", async () => {
    const { fn } = fakeFetch({ "/otp": { body: { success: true, wa_delivered: true } } });
    await expect(requestRegisterCode("81234567890", null, fn)).resolves.toMatchObject({ mode: "login", switchedToLogin: true });
  });

  it("daftar dengan Google: langsung jalur daftar", async () => {
    const { fn, calls } = fakeFetch({ "/register/otp": { body: { success: true } } });
    await requestRegisterCode("81234567890", google, fn);
    expect(calls.map((c) => c.path)).toEqual(["/register/otp"]);
  });

  it("mode demo: kode tetap ikut dikembalikan", async () => {
    const { fn } = fakeFetch({ "/otp": { body: { success: true, wa_delivered: false, demo_code: "123456" } } });
    await expect(requestLoginCode("81234567890", fn)).resolves.toMatchObject({ demoCode: "123456", waDelivered: false });
  });

  it("galat lain diteruskan", async () => {
    const { fn } = fakeFetch({ "/otp": { status: 429, body: { success: false, error: "Terlalu banyak permintaan" } } });
    await expect(requestLoginCode("81234567890", fn)).rejects.toThrow("Terlalu banyak permintaan");
  });
});

describe("verifikasi kode", () => {
  const base: ConfirmInput = { mode: "login", phone: "81234567890", code: "123456", name: "", google: null, devBypass: false };

  it("kode harus 6 digit", async () => {
    const { fn } = fakeFetch({});
    await expect(confirmCode({ ...base, code: "12" }, fn)).rejects.toThrow("6 digit");
  });

  it("masuk lewat /verify", async () => {
    const { fn, calls } = fakeFetch({ "/verify": { body: { success: true } } });
    await confirmCode(base, fn);
    expect(calls[0]).toEqual({ path: "/verify", body: { phone: "+6281234567890", code: "123456" } });
  });

  it("daftar membawa nama, email & tiket Google", async () => {
    const { fn, calls } = fakeFetch({ "/register": { body: { success: true } } });
    await confirmCode({ ...base, mode: "register", name: " Ani ", google }, fn);
    expect(calls[0].body).toEqual({
      phone: "+6281234567890", code: "123456", name: "Ani", email: "ani@gmail.com", google_ticket: "t1", wa_consent: false,
    });
  });

  it("daftar: nomor sudah terdaftar → already_registered", async () => {
    const { fn } = fakeFetch({ "/register": { status: 409, body: { success: false, field: "phone", error: "Nomor ini sudah terdaftar." } } });
    const err = await confirmCode({ ...base, mode: "register", name: "Ani" }, fn).catch((e) => e);
    expect(err.reason).toBe("already_registered");
  });
});

describe("bantuan", () => {
  it("hitung mundur", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(-3)).toBe("0:00");
  });
  it("return path aman", () => {
    expect(safeReturnPath("/member/bookings", "/member")).toBe("/member/bookings");
    expect(safeReturnPath("//evil.com", "/member")).toBe("/member");
    expect(safeReturnPath("https://evil.com", "/member")).toBe("/member");
    expect(safeReturnPath(null, "/member")).toBe("/member");
  });
});
