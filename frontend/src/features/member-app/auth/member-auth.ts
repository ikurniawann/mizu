/**
 * Alur masuk/daftar member Mizu dalam satu layar: nomor WhatsApp → kode OTP.
 * Nomor yang sudah jadi member masuk (POST /otp → /verify); nomor baru otomatis
 * didaftarkan (POST /register/otp → /register) cukup dengan nama. Tiket Google
 * (dari "Daftar dengan Google") selalu lewat jalur daftar dan menautkan akunnya.
 */

export type AuthMode = "login" | "register";

/** Identitas Google terverifikasi yang belum punya member. */
export interface GoogleIdentity {
  ticket: string;
  email: string;
  name: string;
}

export interface CodeSent {
  mode: AuthMode;
  /** WhatsApp terkirim; false = kode belum sampai (gateway WA belum siap). */
  waDelivered: boolean;
  /** Dev lokal: server menerima tanpa kode. */
  devBypass: boolean;
}

export class MemberAuthError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    readonly code?: string
  ) {
    super(message);
  }
}

type Json = { success?: boolean; error?: string; field?: string; code?: string; wa_delivered?: boolean; dev_bypass?: boolean };

type Fetch = typeof fetch;

async function post(fetcher: Fetch, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  let res: Response;
  try {
    res = await fetcher(`/api/member-portal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MemberAuthError("Koneksi bermasalah. Coba lagi.");
  }
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json };
}

/** Nomor dianggap layak dikirimi kode bila berisi 9–15 digit. */
export function isPlausiblePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

/** Kirim kode: coba jalur masuk, lalu jalur daftar untuk nomor baru. */
export async function requestCode(phone: string, google: GoogleIdentity | null, fetcher: Fetch = fetch): Promise<CodeSent> {
  if (!google) {
    const login = await post(fetcher, "/otp", { phone });
    if (login.json.success) {
      return { mode: "login", waDelivered: Boolean(login.json.wa_delivered), devBypass: Boolean(login.json.dev_bypass) };
    }
    if (login.json.code !== "not_registered") {
      throw new MemberAuthError(login.json.error || "Gagal mengirim kode OTP", "phone");
    }
  }
  const reg = await post(fetcher, "/register/otp", { phone });
  if (!reg.json.success) throw new MemberAuthError(reg.json.error || "Gagal mengirim kode OTP", "phone");
  return { mode: "register", waDelivered: Boolean(reg.json.wa_delivered), devBypass: Boolean(reg.json.dev_bypass) };
}

export interface ConfirmInput {
  mode: AuthMode;
  phone: string;
  code: string;
  name: string;
  google: GoogleIdentity | null;
  devBypass: boolean;
}

/** Validasi lokal sebelum konfirmasi; null bila siap dikirim. */
export function confirmProblem(input: ConfirmInput): string | null {
  if (!input.devBypass && !/^\d{6}$/.test(input.code.trim())) return "Kode OTP harus 6 digit";
  if (input.mode === "register" && input.name.trim().length < 2) return "Isi nama lengkap";
  return null;
}

/** Verifikasi kode: masuk (member lama) atau daftar + masuk (member baru). */
export async function confirmCode(input: ConfirmInput, fetcher: Fetch = fetch): Promise<void> {
  const problem = confirmProblem(input);
  if (problem) throw new MemberAuthError(problem, problem.startsWith("Kode") ? "code" : "name");
  const code = input.code.trim();
  if (input.mode === "login") {
    const res = await post(fetcher, "/verify", { phone: input.phone, code });
    if (!res.json.success) throw new MemberAuthError(res.json.error || "Kode OTP salah", "code");
    return;
  }
  const res = await post(fetcher, "/register", {
    phone: input.phone,
    code,
    name: input.name.trim(),
    ...(input.google ? { email: input.google.email, google_ticket: input.google.ticket } : {}),
    wa_consent: false,
  });
  if (!res.json.success) throw new MemberAuthError(res.json.error || "Pendaftaran gagal", res.json.field);
}

/** Tujuan setelah masuk: hanya path aplikasi member (cegah open redirect). */
export function safeReturnPath(from: string | null, fallback: string): string {
  return from && from.startsWith("/member") && !from.startsWith("//") ? from : fallback;
}
