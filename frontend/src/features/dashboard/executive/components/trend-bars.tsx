"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { formatNumber, formatRupiah, formatRupiahCompact } from "@/lib/format";
import type { TrendPoint } from "@/lib/dashboard/executive";

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Angka "bulat" teratas sumbu (1 · 1,2 · 1,5 · 2 · 2,5 · 3 · 4 · 5 · 6 · 8 × 10ⁿ) yang ≥ nilai tertinggi, supaya grafik tidak terlalu pendek. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * exp >= value) return step * exp;
  }
  return 10 * exp;
}

function parts(tanggal: string) {
  const d = new Date(`${tanggal}T00:00:00`);
  return { day: DAY_SHORT[d.getDay()], date: d.getDate(), month: MONTH_SHORT[d.getMonth()] };
}

/**
 * Grafik batang omzet 14 hari (dasbor eksekutif): batang ramping bersudut atas
 * membulat, garis bantu & skala di kiri, pembatas minggu lalu | minggu ini,
 * hari ini beraksen dengan label nilai, hari tanpa penjualan berupa titik, dan
 * tooltip (tanggal, omzet, pesanan) saat diarahkan/difokus.
 */
export function TrendBars({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  const top = niceCeiling(Math.max(...points.map((p) => p.omzet), 0));
  const last = points.length - 1;
  const split = Math.max(0, points.length - 7); // awal "minggu ini"
  const today = points[last];

  return (
    <div className="select-none">
      <div className="relative h-52 pl-11 sm:pl-14">
        {/* Garis bantu + skala */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-11 sm:left-14">
          {[1, 0.5].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ bottom: `${f * 100}%` }}>
              <span className="absolute -left-11 w-9 -translate-y-1/2 text-right text-[10px] text-muted-foreground tabular-nums sm:-left-14 sm:w-12">
                {formatRupiahCompact(top * f)}
              </span>
            </div>
          ))}
          <div className="absolute inset-x-0 bottom-0 border-t border-border" />
          {split > 0 && (
            <div
              className="absolute top-0 bottom-0 border-l border-dashed border-border"
              style={{ left: `${(split / points.length) * 100}%` }}
            />
          )}
        </div>

        <div
          role="img"
          aria-label={`Omzet 14 hari terakhir, hari ini ${formatRupiahCompact(today.omzet)}`}
          className="relative flex h-full items-end"
        >
          {points.map((p, i) => {
            const h = p.omzet > 0 ? Math.max(3, (p.omzet / top) * 100) : 0;
            const isToday = i === last;
            const thisWeek = i >= split;
            const { day, date, month } = parts(p.tanggal);
            const tipAlign = i < 2 ? "left-0" : i > last - 2 ? "right-0" : "left-1/2 -translate-x-1/2";
            const tipStyle: CSSProperties = h > 78 ? { top: 0 } : { bottom: `calc(${h}% + 10px)` };
            return (
              <div
                key={p.tanggal}
                tabIndex={0}
                data-testid="trend-bar"
                aria-label={`${day} ${date} ${month}: ${formatRupiah(p.omzet)}, ${p.pesanan} pesanan`}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center px-[3px] outline-none sm:px-1.5"
              >
                {p.omzet > 0 ? (
                  <div
                    style={{ height: `${h}%` }}
                    className={cn(
                      "w-full max-w-8 rounded-t-[10px] rounded-b-[3px] transition-[filter,background-color] duration-200",
                      isToday
                        ? "bg-gradient-to-t from-forest to-accent-strong shadow-[0_8px_20px_-8px_var(--color-forest)]"
                        : thisWeek
                          ? "bg-gradient-to-t from-silver to-chart-muted group-hover:from-ink-3 group-hover:to-silver group-focus-visible:from-ink-3"
                          : "bg-chart-muted/60 group-hover:bg-silver group-focus-visible:bg-silver",
                    )}
                  />
                ) : (
                  <span data-testid="trend-empty" className="mb-[-3px] size-1.5 rounded-full bg-silver/70" />
                )}
                {isToday && p.omzet > 0 && h <= 78 && (
                  <span
                    className="absolute right-0 rounded-full bg-forest px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-on-ink tabular-nums group-hover:opacity-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2"
                    style={{ bottom: `calc(${h}% + 6px)` }}
                  >
                    {formatRupiahCompact(p.omzet)}
                  </span>
                )}
                <div
                  role="tooltip"
                  className={cn(
                    "pointer-events-none absolute z-10 hidden rounded-xl bg-ink px-3 py-2 text-left text-[11px] whitespace-nowrap text-on-ink shadow-lg group-hover:block group-focus-visible:block",
                    tipAlign,
                  )}
                  style={tipStyle}
                >
                  <span className="block text-on-ink-muted">
                    {day}, {date} {month}
                  </span>
                  <span className="block text-sm font-semibold tabular-nums">{formatRupiah(p.omzet)}</span>
                  <span className="block text-on-ink-muted">{formatNumber(p.pesanan)} pesanan</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hari & tanggal */}
      <div className="mt-2 flex pl-11 sm:pl-14">
        {points.map((p, i) => {
          const { day, date } = parts(p.tanggal);
          const isToday = i === last;
          return (
            <span key={p.tanggal} className="flex min-w-0 flex-1 flex-col items-center leading-tight">
              <span className={cn("text-[10px]", isToday ? "font-semibold text-foreground" : "text-muted-foreground")}>
                <span className="sm:hidden">{day.charAt(0)}</span>
                <span className="hidden sm:inline">{day}</span>
              </span>
              <span
                className={cn(
                  "mt-0.5 grid size-[18px] place-items-center rounded-full text-[9px] tabular-nums sm:size-5 sm:text-[10px]",
                  isToday ? "bg-forest font-semibold text-on-ink" : "text-muted-foreground/80",
                )}
              >
                {date}
              </span>
            </span>
          );
        })}
      </div>

      {/* Legenda */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-11 text-[11px] text-muted-foreground sm:pl-14">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-muted/60" /> 7 hari sebelumnya
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-silver" /> Minggu ini
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-forest" /> Hari ini
        </span>
      </div>
    </div>
  );
}
