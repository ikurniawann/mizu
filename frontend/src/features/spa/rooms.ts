import type { RoomState } from "./types";

/** Label & warna status room di papan Room (revisi R6). */
export const ROOM_STATE_LABEL: Record<RoomState, string> = {
  free: "Kosong",
  reserved: "Akan dipakai",
  occupied: "Terisi",
  done: "Selesai · belum checkout",
  inactive: "Nonaktif",
};

export const ROOM_STATE_VARIANT: Record<RoomState, "success" | "info" | "accent" | "warning" | "muted"> = {
  free: "success",
  reserved: "info",
  occupied: "accent",
  done: "warning",
  inactive: "muted",
};

/**
 * Sisa detik treatment yang berjalan (revisi R9): hitung mundur dari
 * started_at + total durasi. Negatif berarti sudah lewat (overtime).
 */
export function remainingSeconds(startedAt: string, durationMin: number, now: Date = new Date()): number {
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.round((start + durationMin * 60_000 - now.getTime()) / 1000);
}

/** "12:05" untuk 725 detik; lewat waktu ditandai "+" ("+03:10"). */
export function countdownLabel(seconds: number): string {
  const over = seconds < 0;
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  const body = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return over ? `+${body}` : body;
}

/** Nada hitung mundur: normal, hampir habis (≤ 5 menit), lewat waktu. */
export function countdownTone(seconds: number): "normal" | "ending" | "over" {
  if (seconds < 0) return "over";
  if (seconds <= 5 * 60) return "ending";
  return "normal";
}
