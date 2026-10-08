"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { asset, m } from "../lib/links";
import { Spinner } from "../ui";
import { GoogleSignIn, type GoogleNeedsPhone } from "./google-sign-in";
import {
  confirmCode,
  isPlausiblePhone,
  MemberAuthError,
  requestCode,
  safeReturnPath,
  type CodeSent,
  type GoogleIdentity,
} from "./member-auth";
import "../member-app.css";

/** useSearchParams butuh Suspense saat prerender. */
export function MemberAuthPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MemberAuth />
    </Suspense>
  );
}

/**
 * Masuk / daftar member Mizu: nomor WhatsApp → kirim OTP → kode.
 * Nomor baru cukup menambah nama; "Daftar dengan Google" mengisi nama dan
 * email dari Gmail lalu tetap memverifikasi nomor lewat OTP.
 */
function MemberAuth() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const ticket = params.get("ticket");
  const [google, setGoogle] = useState<GoogleIdentity | null>(
    ticket ? { ticket, email: params.get("email") ?? "", name: params.get("name") ?? "" } : null
  );
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(google?.name ?? "");
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signedIn = useCallback(() => {
    // Cache 401 dari sesi lama dibuang supaya guard aplikasi memuat ulang.
    qc.clear();
    router.replace(safeReturnPath(params.get("from"), m("/")));
  }, [qc, router, params]);

  const onGoogle = useCallback((identity: GoogleNeedsPhone) => {
    setGoogle(identity);
    setName((current) => current || identity.name);
    setSent(null);
    setError("");
  }, []);

  const fail = (e: unknown) => setError(e instanceof MemberAuthError || e instanceof Error ? e.message : "Terjadi kesalahan");

  const send = async () => {
    if (!isPlausiblePhone(phone)) {
      setError("Masukkan nomor WhatsApp yang valid");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setSent(await requestCode(phone, google));
      setCode("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!sent) return;
    setBusy(true);
    setError("");
    try {
      await confirmCode({ mode: sent.mode, phone, code, name, google, devBypass: sent.devBypass });
      signedIn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const registering = sent?.mode === "register";

  return (
    <div className="nh-app">
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/wordmark-black.png")} alt="Mizu" className="mx-auto h-9 w-auto" />
          <h1 className="nh-display mt-6 text-3xl">{sent ? "Masukkan kode OTP" : "Masuk atau daftar"}</h1>
          <p className="mt-1.5 text-sm text-nh-muted">
            {sent
              ? `Kode 6 digit dikirim ke WhatsApp ${phone}.`
              : "Masukkan nomor WhatsApp, kami kirim kode OTP."}
          </p>
        </div>

        <div className="nh-card !p-6">
          {google ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-nh-raised p-3 text-sm">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-nh-ok" />
              <p>
                Terhubung dengan Google <b>{google.email}</b>. Verifikasi nomor WhatsApp untuk menyelesaikan pendaftaran.
              </p>
            </div>
          ) : null}

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void (sent ? confirm() : send());
            }}
          >
            {!sent ? (
              <div>
                <label className="nh-label" htmlFor="phone">
                  Nomor WhatsApp
                </label>
                <input
                  id="phone"
                  className="nh-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="08xxxxxxxxxx"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError("");
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="nh-label" htmlFor="code">
                    Kode OTP
                  </label>
                  <input
                    id="code"
                    className="nh-input text-center text-2xl tracking-[0.5em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      setError("");
                    }}
                    autoFocus
                  />
                  {!sent.waDelivered && !sent.devBypass ? (
                    <p className="mt-2 text-xs text-nh-warn">
                      Kode belum terkirim lewat WhatsApp. Tunggu sebentar lalu kirim ulang, atau hubungi outlet Mizu.
                    </p>
                  ) : null}
                </div>
                {registering ? (
                  <div>
                    <label className="nh-label" htmlFor="name">
                      Nama lengkap
                    </label>
                    <input
                      id="name"
                      className="nh-input"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Nama kamu"
                    />
                    <p className="mt-1.5 text-xs text-nh-muted">Nomor ini belum terdaftar — kami buatkan akun member baru.</p>
                  </div>
                ) : null}
              </>
            )}

            <button type="submit" className="nh-btn-brand flex items-center justify-center gap-2" disabled={busy}>
              {busy ? "Memproses…" : !sent ? "Kirim OTP" : registering ? "Daftar & masuk" : "Masuk"}
              <ArrowRight size={18} />
            </button>
            {sent ? (
              <button
                type="button"
                className="text-sm font-bold text-nh-ink/60"
                onClick={() => {
                  setSent(null);
                  setError("");
                }}
              >
                Ganti nomor atau kirim ulang
              </button>
            ) : null}
            {error ? (
              <p className="text-sm font-bold text-nh-danger" role="alert">
                {error}
              </p>
            ) : null}
          </form>

          {!sent && !google ? (
            <div className="mt-4">
              <GoogleSignIn onSignedIn={signedIn} onNeedsPhone={onGoogle} text="signup_with" />
            </div>
          ) : null}
        </div>

        <p className="text-center text-xs text-nh-muted">
          Dengan melanjutkan, kamu menyetujui{" "}
          <Link href="/terms" className="underline">
            Syarat Layanan
          </Link>{" "}
          dan{" "}
          <Link href="/privacy" className="underline">
            Kebijakan Privasi
          </Link>{" "}
          Mizu.
        </p>
      </main>
    </div>
  );
}
