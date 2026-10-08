"use client";

import { useEffect, useRef } from "react";

/**
 * Kode OTP 6 kotak. Satu input tersembunyi di atas kotak-kotak, jadi tempel
 * kode, isi otomatis SMS/WhatsApp (one-time-code) dan hapus berjalan wajar;
 * `onComplete` terpanggil begitu 6 digit terisi.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  invalid = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        aria-label="Kode verifikasi 6 digit"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
      />
      <div className="flex justify-between gap-2" aria-hidden>
        {Array.from({ length }, (_, i) => {
          const filled = i < value.length;
          const active = i === Math.min(value.length, length - 1) && !disabled;
          return (
            <div
              key={i}
              className={`flex h-14 w-full max-w-12 items-center justify-center rounded-xl border-2 bg-white text-2xl font-bold transition-colors ${
                invalid
                  ? "border-nh-danger text-nh-danger"
                  : active
                    ? "border-nh-forest"
                    : filled
                      ? "border-nh-line"
                      : "border-nh-line/80"
              }`}
            >
              {value[i] ?? (active ? <span className="h-6 w-0.5 animate-pulse bg-nh-forest" /> : "")}
            </div>
          );
        })}
      </div>
    </div>
  );
}
