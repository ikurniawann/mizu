"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { useLang } from "../lib/lang";

/** Identitas Google yang belum punya member: lanjut ke pendaftaran dengan tiket. */
export interface GoogleNeedsPhone {
  ticket: string;
  email: string;
  name: string;
}

type GoogleResponse =
  | { status: "signed_in"; name: string | null }
  | ({ status: "needs_phone"; google_sub: string } & GoogleNeedsPhone);

interface GsiButtonConfig {
  theme: "outline" | "filled_black";
  size: "large";
  width: number;
  text: "signin_with" | "signup_with" | "continue_with";
  shape: "pill";
  locale: string;
}

interface GsiApi {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (parent: HTMLElement, config: GsiButtonConfig) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GsiApi;
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** Memuat Google Identity Services sekali; resolve saat window.google siap. */
function loadGsi(): Promise<GsiApi> {
  if (window.google) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const done = () => (window.google ? resolve(window.google) : reject(new Error("gsi")));
    script.addEventListener("load", done);
    script.addEventListener("error", () => reject(new Error("gsi")));
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Tombol "Masuk dengan Google" (GIS). Tampil hanya bila
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID diisi. Token ID dikirim ke
 * POST /api/member-portal/auth/google; member yang dikenal langsung masuk,
 * yang belum dikenal diarahkan melengkapi nomor WhatsApp.
 */
export function GoogleSignIn({
  onSignedIn,
  onNeedsPhone,
  text = "signin_with",
  withDivider = true,
  showWhenDisabled = false,
}: {
  onSignedIn: () => void;
  onNeedsPhone: (identity: GoogleNeedsPhone) => void;
  text?: GsiButtonConfig["text"];
  /** Garis "atau" di atas tombol (layar lama); layar masuk/daftar menaruhnya sendiri. */
  withDivider?: boolean;
  /** Tanpa Client ID: tetap tampilkan tombol nonaktif (pilihan terlihat, belum bisa dipakai). */
  showWhenDisabled?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID || !slot.current) return;
    let cancelled = false;
    const parent = slot.current;
    loadGsi()
      .then((google) => {
        if (cancelled) return;
        parent.replaceChildren();
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/member-portal/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_token: credential }),
              });
              const json = (await res.json()) as { success: boolean; error?: string; data?: GoogleResponse };
              if (!res.ok || !json.success || !json.data) throw new Error(json.error || t("Google sign-in failed."));
              if (json.data.status === "signed_in") onSignedIn();
              else onNeedsPhone({ ticket: json.data.ticket, email: json.data.email, name: json.data.name });
            } catch (e) {
              setError(e instanceof Error ? e.message : t("Google sign-in failed."));
            } finally {
              setBusy(false);
            }
          },
        });
        google.accounts.id.renderButton(parent, {
          theme: "outline",
          size: "large",
          width: Math.min(parent.clientWidth || 320, 400),
          text,
          shape: "pill",
          locale: lang,
        });
      })
      .catch(() => setError(t("Google sign-in is unavailable right now.")));
    return () => {
      cancelled = true;
    };
  }, [onSignedIn, onNeedsPhone, t, text, lang]);

  if (!CLIENT_ID) {
    if (!showWhenDisabled) return null;
    const label = text === "signup_with" ? "Daftar dengan Google" : text === "continue_with" ? "Lanjutkan dengan Google" : "Masuk dengan Google";
    return (
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          disabled
          className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-nh-line bg-white text-sm font-semibold text-nh-ink/50"
        >
          <GoogleG />
          {label}
        </button>
        <p className="text-xs text-nh-muted">Masuk dengan Google segera tersedia.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {withDivider ? (
        <div className="flex items-center gap-3 text-xs font-bold tracking-wider text-nh-muted uppercase">
          <span className="h-px flex-1 bg-nh-line" />
          {t("or")}
          <span className="h-px flex-1 bg-nh-line" />
        </div>
      ) : null}
      <div ref={slot} className={`flex min-h-11 justify-center ${busy ? "pointer-events-none opacity-60" : ""}`} />
      {error ? <p className="text-center text-sm font-bold text-nh-danger">{error}</p> : null}
    </div>
  );
}

/** Logo "G" Google (warna resmi) untuk tombol nonaktif. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
