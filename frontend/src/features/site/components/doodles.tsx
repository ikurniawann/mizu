import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Doodle khas Paddy (mata "googly", sparkle, hati, coretan) sebagai SVG
 * inline, plus badge stiker. Semuanya dekoratif (aria-hidden) dan mengikuti
 * palet Paddy: garis navy, isian putih/sunny/magenta.
 */

const NAVY = "#232c6b";

export function GooglyEyes({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 120 70" className={cn("h-auto w-16", className)} fill="none">
      <g transform="rotate(-8 30 35)">
        <ellipse cx="30" cy="35" rx="25" ry="30" fill="#fff" stroke={NAVY} strokeWidth="5" />
        <circle cx="35" cy="39" r="15" fill={NAVY} />
        <path d="M34 30c1 5 2 6 7 7-5 1-6 2-7 7-1-5-2-6-7-7 5-1 6-2 7-7z" fill="#fff" />
      </g>
      <g transform="rotate(6 88 35)">
        <ellipse cx="88" cy="35" rx="25" ry="30" fill="#fff" stroke={NAVY} strokeWidth="5" />
        <circle cx="93" cy="39" r="15" fill={NAVY} />
        <path d="M92 30c1 5 2 6 7 7-5 1-6 2-7 7-1-5-2-6-7-7 5-1 6-2 7-7z" fill="#fff" />
      </g>
    </svg>
  );
}

export function Sparkle({ className, fill = "currentColor", outline = false }: { className?: string; fill?: string; outline?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 40 40" className={cn("size-6", className)}>
      <path
        d="M20 2c2 11 7 16 18 18-11 2-16 7-18 18-2-11-7-16-18-18 11-2 16-7 18-18z"
        fill={fill}
        stroke={outline ? NAVY : "none"}
        strokeWidth={outline ? 2.5 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DoodleHeart({ className, fill = "currentColor" }: { className?: string; fill?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 40 36" className={cn("size-6", className)}>
      <path
        d="M20 33C12 27 3 20 3 11.5 3 6.5 7 3 11.5 3c3.5 0 6.5 2 8.5 5 2-3 5-5 8.5-5C33 3 37 6.5 37 11.5 37 20 28 27 20 33z"
        fill={fill}
        stroke={NAVY}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Squiggle({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 120 20" className={cn("h-4 w-24", className)} fill="none">
      <path d="M4 10q7.5-12 15 0t15 0 15 0 15 0 15 0 15 0 15 0" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Badge miring ala stiker: isian cerah, garis navy, bayangan offset. */
export function StickerBadge({
  children,
  tone = "sunny",
  className,
}: {
  children: ReactNode;
  tone?: "sunny" | "pink" | "lilac" | "grass" | "sky";
  className?: string;
}) {
  const tones = {
    sunny: "bg-sunny text-navy",
    pink: "bg-accent text-accent-foreground",
    lilac: "bg-everglade text-white",
    grass: "bg-grass text-white",
    sky: "bg-sky text-navy",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 border-navy px-3 py-1 text-xs font-extrabold tracking-wide uppercase shadow-[3px_3px_0_0_var(--color-navy)]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Latar doodle Paddy (gambar) untuk blok berwarna; konten di atasnya. */
export function DoodleBackdrop({ tone = "pink", className }: { tone?: "pink" | "lilac" | "sunny"; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      aria-hidden
      alt=""
      src={tone === "pink" ? "/brand/paddy-wallpaper.webp" : `/brand/paddy-wallpaper-${tone}.webp`}
      className={cn("pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover", className)}
    />
  );
}
