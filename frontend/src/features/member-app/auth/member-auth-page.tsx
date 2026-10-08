"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { asset, m } from "../lib/links";
import { Spinner } from "../ui";
import { GoogleSignIn, type GoogleNeedsPhone } from "./google-sign-in";
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
  RESEND_SECONDS,
  safeReturnPath,
  type CodeSent,
  type GoogleIdentity,
} from "./member-auth";
import { OtpInput } from "./otp-input";
import "../member-app.css";

/* ── halaman ─────────────────────────────────────────────────────────── */

/** /member/auth/login */
export function MemberLoginPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthFlow mode="login" />
    </Suspense>
  );
}

/** /member/auth/register */
export function MemberRegisterPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthFlow mode="register" />
    </Suspense>
  );
}

type Problem = { message: string; reason?: MemberAuthError["reason"] };

function AuthFlow({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const ticket = params.get("ticket");

  const [google, setGoogle] = useState<GoogleIdentity | null>(
    ticket ? { ticket, email: params.get("email") ?? "", name: params.get("name") ?? "" } : null
  );
  const [phone, setPhone] = useState(nationalDigits(params.get("phone") ?? ""));
  const [name, setName] = useState(google?.name ?? "");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const signedIn = useCallback(() => {
    // Cache 401 dari sesi lama dibuang supaya guard aplikasi memuat ulang.
    qc.clear();
    router.replace(safeReturnPath(params.get("from"), m("/")));
  }, [qc, router, params]);

  // Akun Google yang belum tertaut: lanjut ke Daftar dengan nama & email terisi.
  const onGoogleNeedsPhone = useCallback(
    (identity: GoogleNeedsPhone) => {
      if (mode === "register") {
        setGoogle(identity);
        setName((n) => n || identity.name);
        setProblem(null);
        return;
      }
      router.push(`${m("/auth/register")}?${new URLSearchParams({ ...identity })}`);
    },
    [mode, router]
  );

  const goTo = (target: "login" | "register") => {
    const q = new URLSearchParams();
    if (phone) q.set("phone", phone);
    const from = params.get("from");
    if (from) q.set("from", from);
    router.push(`${m(`/auth/${target}`)}${q.size ? `?${q}` : ""}`);
  };

  const phoneOk = isValidNational(phone);
  const nameOk = mode === "login" || isValidName(name);

  const send = async () => {
    setTouched(true);
    if (!phoneOk || !nameOk) return;
    setBusy(true);
    setProblem(null);
    try {
      setSent(mode === "login" ? await requestLoginCode(phone) : await requestRegisterCode(phone, google));
    } catch (e) {
      setProblem(toProblem(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell>
        <OtpStep
          sent={sent}
          phone={phone}
          name={name}
          google={google}
          onBack={() => setSent(null)}
          onResent={setSent}
          onSignedIn={signedIn}
          onGoLogin={() => goTo("login")}
        />
      </Shell>
    );
  }

  const isLogin = mode === "login";
  return (
    <Shell>
      <header>
        <h1 className="nh-display text-[28px] leading-tight">{isLogin ? "Masuk" : "Buat akun"}</h1>
        <p className="mt-1.5 text-[15px] text-nh-muted">
          {isLogin
            ? "Selamat datang kembali. Masuk untuk booking dan melihat riwayat treatment."
            : "Daftar sekali, booking treatment jadi lebih cepat dan riwayatmu tersimpan."}
        </p>
      </header>

      {google ? (
        <div className="flex items-center gap-3 rounded-2xl border border-nh-line bg-white p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-nh-lime-soft font-bold text-nh-forest">
            {(google.name || google.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{google.name || "Akun Google"}</p>
            <p className="truncate text-xs text-nh-muted">{google.email}</p>
          </div>
          <button
            type="button"
            aria-label="Batalkan akun Google"
            className="rounded-full p-1.5 text-nh-muted hover:bg-nh-raised"
            onClick={() => setGoogle(null)}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <>
          <GoogleSignIn
            onSignedIn={signedIn}
            onNeedsPhone={onGoogleNeedsPhone}
            text={isLogin ? "continue_with" : "signup_with"}
            withDivider={false}
            showWhenDisabled
            locale="id"
          />
          <Divider>{isLogin ? "atau masuk dengan nomor HP" : "atau daftar dengan nomor HP"}</Divider>
        </>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void send();
        }}
      >
        {!isLogin ? (
          <Field label="Nama lengkap" htmlFor="name" error={touched && !nameOk ? "Isi nama lengkap kamu" : undefined}>
            <input
              id="name"
              className="h-12 w-full rounded-xl border border-nh-line bg-white px-4 text-base outline-none focus:border-nh-forest focus:ring-2 focus:ring-nh-forest/15"
              autoComplete="name"
              placeholder="Contoh: Ani Lestari"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        ) : null}

        <Field
          label="Nomor WhatsApp"
          htmlFor="phone"
          hint={!touched || phoneOk ? "Kode verifikasi dikirim lewat WhatsApp." : undefined}
          error={touched && !phoneOk ? "Masukkan nomor HP yang valid, contoh 812-3456-7890" : undefined}
        >
          <PhoneInput value={phone} onChange={(v) => { setPhone(v); setProblem(null); }} autoFocus={isLogin && !google} />
        </Field>

        {problem ? <ProblemBox problem={problem} onRegister={() => goTo("register")} onLogin={() => goTo("login")} /> : null}

        <button type="submit" className="nh-btn-brand h-12 w-full text-base" disabled={busy}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : null}
          {busy ? "Mengirim kode…" : isLogin ? "Lanjut" : "Daftar"}
        </button>
      </form>

      <p className="text-center text-sm text-nh-muted">
        {isLogin ? "Belum punya akun? " : "Sudah punya akun? "}
        <button type="button" className="font-bold text-nh-forest underline-offset-4 hover:underline" onClick={() => goTo(isLogin ? "register" : "login")}>
          {isLogin ? "Daftar" : "Masuk"}
        </button>
      </p>

      {!isLogin ? <Legal /> : null}
    </Shell>
  );
}

/* ── langkah kode OTP ────────────────────────────────────────────────── */

function OtpStep({
  sent,
  phone,
  name,
  google,
  onBack,
  onResent,
  onSignedIn,
  onGoLogin,
}: {
  sent: CodeSent;
  phone: string;
  name: string;
  google: GoogleIdentity | null;
  onBack: () => void;
  onResent: (s: CodeSent) => void;
  onSignedIn: () => void;
  onGoLogin: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [left, setLeft] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  const confirm = async (value: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await confirmCode({ mode: sent.mode, phone, code: value, name, google, devBypass: sent.devBypass });
      onSignedIn();
    } catch (e) {
      setProblem(toProblem(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setProblem(null);
    try {
      onResent(sent.mode === "login" ? await requestLoginCode(phone) : await requestRegisterCode(phone, google));
      setLeft(RESEND_SECONDS);
      setCode("");
    } catch (e) {
      setProblem(toProblem(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={onBack} className="-ml-2 flex w-fit items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-nh-muted hover:bg-nh-raised">
        <ArrowLeft size={16} /> Kembali
      </button>
      <header>
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-nh-lime-soft text-nh-forest">
          <MessageCircle size={22} />
        </span>
        <h1 className="nh-display text-[28px] leading-tight">Masukkan kode verifikasi</h1>
        <p className="mt-1.5 text-[15px] text-nh-muted">
          Kode 6 digit dikirim lewat WhatsApp ke <b className="whitespace-nowrap text-nh-ink">+62 {formatNational(phone)}</b>.{" "}
          <button type="button" className="font-bold text-nh-forest underline-offset-4 hover:underline" onClick={onBack}>
            Ubah
          </button>
        </p>
        {sent.switchedToLogin ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-nh-raised p-3 text-sm">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-nh-ok" />
            Nomor ini sudah punya akun Mizu — masukkan kode untuk langsung masuk.
          </p>
        ) : null}
      </header>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void confirm(code);
        }}
      >
        <OtpInput value={code} onChange={(v) => { setCode(v); setProblem(null); }} onComplete={(v) => void confirm(v)} invalid={Boolean(problem)} disabled={busy} />
        {sent.demoCode ? (
          <p className="rounded-xl border border-nh-lime/60 bg-nh-lime-soft p-3 text-sm">
            <b>Mode demo:</b> masukkan kode <b className="tracking-widest">{sent.demoCode}</b>.
          </p>
        ) : !sent.waDelivered && !sent.devBypass ? (
          <p className="rounded-xl bg-nh-warn/10 p-3 text-sm text-nh-warn">
            Kode belum berhasil dikirim ke WhatsApp. Tunggu sebentar lalu kirim ulang, atau hubungi outlet Mizu.
          </p>
        ) : null}
        {problem ? <ProblemBox problem={problem} onLogin={onGoLogin} /> : null}
        <button type="submit" className="nh-btn-brand h-12 w-full text-base" disabled={busy || (!sent.devBypass && code.length < 6)}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : null}
          {busy ? "Memverifikasi…" : sent.mode === "register" ? "Verifikasi & buat akun" : "Verifikasi & masuk"}
        </button>
      </form>

      <p className="text-center text-sm text-nh-muted">
        Tidak menerima kode?{" "}
        {left > 0 ? (
          <span>Kirim ulang dalam {formatCountdown(left)}</span>
        ) : (
          <button type="button" className="font-bold text-nh-forest underline-offset-4 hover:underline disabled:opacity-50" disabled={resending} onClick={() => void resend()}>
            {resending ? "Mengirim…" : "Kirim ulang kode"}
          </button>
        )}
      </p>
    </>
  );
}

/* ── bagian kecil ────────────────────────────────────────────────────── */

function toProblem(e: unknown): Problem {
  if (e instanceof MemberAuthError) return { message: e.message, reason: e.reason };
  return { message: e instanceof Error ? e.message : "Terjadi kesalahan. Coba lagi." };
}

/** Kerangka: panel merek (desktop) + kolom form. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="nh-app">
      <div className="flex min-h-dvh">
        <aside className="relative hidden flex-1 overflow-hidden bg-nh-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/mizu-wallpaper.webp")} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/lockup-white.png")} alt="Mizu" className="relative w-80" />
          <div className="relative text-white">
            <p className="nh-display text-5xl leading-tight">Rest. Relax.</p>
            <p className="nh-display text-5xl leading-tight text-nh-lime italic">Rejuvenate.</p>
            <p className="mt-4 max-w-sm text-white/70">Mizu Family Massage &amp; Reflexology — Mizu 1.0 Westhoff &amp; Mizu Signature Riau, Bandung.</p>
          </div>
        </aside>
        <main className="flex w-full flex-col px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-8 lg:max-w-xl lg:justify-center lg:px-16">
          <Link href="/" className="mb-8 w-fit lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("/brand/wordmark-black.png")} alt="Mizu" className="h-8 w-auto" />
          </Link>
          <div className="mx-auto flex w-full max-w-sm flex-col gap-5">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-nh-muted">
      <span className="h-px flex-1 bg-nh-line" />
      {children}
      <span className="h-px flex-1 bg-nh-line" />
    </div>
  );
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-semibold text-nh-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-nh-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Nomor HP dengan awalan +62 tetap, format 812-3456-7890 saat mengetik. */
function PhoneInput({ value, onChange, autoFocus }: { value: string; onChange: (digits: string) => void; autoFocus?: boolean }) {
  return (
    <div className="flex h-12 items-center rounded-xl border border-nh-line bg-white focus-within:border-nh-forest focus-within:ring-2 focus-within:ring-nh-forest/15">
      <span className="flex h-full items-center gap-1.5 border-r border-nh-line px-3 text-base font-semibold text-nh-ink/80">
        <span aria-hidden>🇮🇩</span> +62
      </span>
      <input
        id="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="812-3456-7890"
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-base tracking-wide outline-none"
        value={formatNational(value)}
        onChange={(e) => onChange(nationalDigits(e.target.value))}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function ProblemBox({ problem, onRegister, onLogin }: { problem: Problem; onRegister?: () => void; onLogin?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-nh-danger/25 bg-nh-danger/5 p-3 text-sm">
      <p className="font-semibold text-nh-danger">{problem.message}</p>
      {problem.reason === "not_registered" && onRegister ? (
        <button type="button" className="mt-2 font-bold text-nh-forest underline underline-offset-4" onClick={onRegister}>
          Daftar dengan nomor ini
        </button>
      ) : null}
      {problem.reason === "already_registered" && onLogin ? (
        <button type="button" className="mt-2 font-bold text-nh-forest underline underline-offset-4" onClick={onLogin}>
          Masuk dengan nomor ini
        </button>
      ) : null}
    </div>
  );
}

function Legal() {
  return (
    <p className="text-center text-xs leading-relaxed text-nh-muted">
      Dengan mendaftar, kamu menyetujui{" "}
      <Link href="/terms" className="underline underline-offset-2">
        Syarat Layanan
      </Link>{" "}
      dan{" "}
      <Link href="/privacy" className="underline underline-offset-2">
        Kebijakan Privasi
      </Link>{" "}
      Mizu.
    </p>
  );
}
