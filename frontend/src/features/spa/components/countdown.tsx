"use client";

import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { countdownLabel, countdownTone, remainingSeconds } from "../rooms";

/**
 * Hitung mundur treatment yang sedang berjalan (revisi R9): dari waktu Mulai
 * ditekan + total durasi treatment; menguning saat ≤ 5 menit, memerah saat lewat.
 */
export function Countdown({ startedAt, durationMin, className, size = "md" }: { startedAt: string; durationMin: number; className?: string; size?: "md" | "lg" }) {
  // Detik berjalan dari interval; sisa waktu diturunkan dari props + waktu sekarang.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = remainingSeconds(startedAt, durationMin, new Date(now));
  const tone = countdownTone(seconds);
  return (
    <span
      role="timer"
      aria-live="off"
      title={tone === "over" ? "Lewat dari durasi layanan" : "Sisa waktu layanan"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono font-semibold tabular-nums",
        size === "lg" ? "text-2xl" : "text-sm",
        tone === "normal" && "bg-surface text-foreground",
        tone === "ending" && "bg-warning-soft text-warning",
        tone === "over" && "bg-danger-soft text-danger",
        className,
      )}
    >
      <Hourglass className={size === "lg" ? "size-5" : "size-3.5"} />
      {countdownLabel(seconds)}
      {tone === "over" ? <span className="text-xs font-sans font-medium">lewat</span> : null}
    </span>
  );
}
