"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { resolveNavFrom } from "./nav-context";

function readNavFrom(pathname: string): string | null {
  if (typeof window === "undefined") return null;
  // Saat navigasi klien, render pertama halaman baru masih melihat URL lama:
  // abaikan ?from= milik halaman sebelumnya dan pakai asal tersimpan.
  const urlIsCurrent = window.location.pathname === pathname;
  const queryFrom = urlIsCurrent ? new URLSearchParams(window.location.search).get("from") : null;
  return resolveNavFrom(pathname, queryFrom);
}

/** Reads `from` query param (with session fallback) without a Suspense boundary. */
export function useNavFrom(): string | null {
  const pathname = usePathname();
  const [current, setCurrent] = useState(() => ({ pathname, navFrom: readNavFrom(pathname) }));
  // Baca ulang saat pindah halaman (pola "sesuaikan state saat render", tanpa effect).
  if (current.pathname !== pathname) {
    const next = { pathname, navFrom: readNavFrom(pathname) };
    setCurrent(next);
    return next.navFrom;
  }
  return current.navFrom;
}
