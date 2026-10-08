/**
 * Logika masuk/daftar member Mizu (tanpa UI).
 *
 * Masuk : nomor WhatsApp → POST /otp → kode → POST /verify.
 * Daftar: nama + nomor → POST /register/otp → kode → POST /register.
 *         Nomor yang ternyata sudah member dialihkan ke jalur masuk otomatis.
 * Google: POST /auth/google; akun yang belum tertaut lanjut ke Daftar dengan
 *         nama & email terisi (tiket), nomor tetap diverifikasi sekali.
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
  /** Daftar dialihkan ke masuk karena nomor sudah member. */
  switchedToLogin?: boolean;
}

/** Galat yang ditampilkan; `reason` membedakan kasus yang punya aksi lanjutan. */
export class MemberAuthError extends Error {
  constructor(
    message: string,
    readonly reason: "not_registered" | "already_registered" | "code" | "phone" | "name" | "google" | "other" = "other"
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
    throw new MemberAuthError("Koneksi bermasalah. Periksa internet lalu coba lagi.");
  }
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json };
}

/* ── nomor HP ────────────────────────────────────────────────────────── */

/** Digit nasional tanpa awalan 0 / 62 / +62 ("0812-345" → "812345"). */
export function nationalDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("62")) d = d.slice(2);
  while (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 13);
}

/** Tampilan berkelompok "812-3456-7890". */
export function formatNational(digits: string): string {
  const d = nationalDigits(digits);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** Nomor lengkap untuk API ("+62812…"). */
export function toApiPhone(digits: string): string {
  return `+62${nationalDigits(digits)}`;
}

/** Nomor HP Indonesia: diawali 8, 9–12 digit tanpa awalan. */
export function isValidNational(digits: string): boolean {
  const d = nationalDigits(digits);
  return /^8\d{8,11}$/.test(d);
}

/* ── kode OTP ────────────────────────────────────────────────────────── */

/** Jeda sebelum boleh kirim ulang kode (detik). */
export const RESEND_SECONDS = 60;

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function sent(json: Json, mode: AuthMode, switchedToLogin = false): CodeSent {
  return { mode, waDelivered: Boolean(json.wa_delivered), devBypass: Boolean(json.dev_bypass), switchedToLogin };
}

/** Masuk: kirim kode ke member. Nomor baru → MemberAuthError("not_registered"). */
export async function requestLoginCode(phone: string, fetcher: Fetch = fetch): Promise<CodeSent> {
  const res = await post(fetcher, "/otp", { phone: toApiPhone(phone) });
  if (res.json.success) return sent(res.json, "login");
  if (res.json.code === "not_registered") {
    throw new MemberAuthError("Nomor ini belum terdaftar sebagai member Mizu.", "not_registered");
  }
  throw new MemberAuthError(res.json.error || "Gagal mengirim kode. Coba lagi.", "phone");
}

/**
 * Daftar: kirim kode pendaftaran. Tanpa Google, nomor yang ternyata sudah
 * member langsung diarahkan ke jalur masuk (kode masuk yang dikirim).
 */
export async function requestRegisterCode(phone: string, google: GoogleIdentity | null, fetcher: Fetch = fetch): Promise<CodeSent> {
  if (!google) {
    const login = await post(fetcher, "/otp", { phone: toApiPhone(phone) });
    if (login.json.success) return sent(login.json, "login", true);
    if (login.json.code !== "not_registered") {
      throw new MemberAuthError(login.json.error || "Gagal mengirim kode. Coba lagi.", "phone");
    }
  }
  const res = await post(fetcher, "/register/otp", { phone: toApiPhone(phone) });
  if (!res.json.success) throw new MemberAuthError(res.json.error || "Gagal mengirim kode. Coba lagi.", "phone");
  return sent(res.json, "register");
}

export interface ConfirmInput {
  mode: AuthMode;
  phone: string;
  code: string;
  name: string;
  google: GoogleIdentity | null;
  devBypass: boolean;
}

/** Verifikasi kode: masuk (member lama) atau daftar + masuk (member baru). */
export async function confirmCode(input: ConfirmInput, fetcher: Fetch = fetch): Promise<void> {
  const code = input.code.trim();
  if (!input.devBypass && !/^\d{6}$/.test(code)) throw new MemberAuthError("Masukkan 6 digit kode.", "code");
  if (input.mode === "login") {
    const res = await post(fetcher, "/verify", { phone: toApiPhone(input.phone), code });
    if (!res.json.success) throw new MemberAuthError(res.json.error || "Kode salah atau sudah kedaluwarsa.", "code");
    return;
  }
  const res = await post(fetcher, "/register", {
    phone: toApiPhone(input.phone),
    code,
    name: input.name.trim(),
    ...(input.google ? { email: input.google.email, google_ticket: input.google.ticket } : {}),
    wa_consent: false,
  });
  if (res.json.success) return;
  if (res.status === 409 && res.json.field === "phone") {
    throw new MemberAuthError("Nomor ini sudah terdaftar. Silakan masuk.", "already_registered");
  }
  if (res.json.field === "google_ticket") throw new MemberAuthError(res.json.error || "Sesi Google kedaluwarsa. Ulangi.", "google");
  throw new MemberAuthError(res.json.error || "Pendaftaran gagal. Coba lagi.", res.json.field === "code" ? "code" : "other");
}

/** Nama lengkap layak: minimal 2 huruf. */
export function isValidName(name: string): boolean {
  return name.trim().length >= 2;
}

/** Tujuan setelah masuk: hanya path aplikasi member (cegah open redirect). */
export function safeReturnPath(from: string | null, fallback: string): string {
  return from && from.startsWith("/member") && !from.startsWith("//") ? from : fallback;
}
