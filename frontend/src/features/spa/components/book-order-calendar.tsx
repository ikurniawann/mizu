"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { UserRoundX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { initials } from "@/lib/hris/ess-view";
import { cn } from "@/lib/utils";
import {
  clockOf,
  dayRange,
  hourMarks,
  isDraggable,
  layoutColumn,
  minuteAtOffset,
  nowOffset,
  offShiftBands,
  PX_PER_MIN,
  type DayRange,
  type Placed,
} from "../calendar";
import { genderLabel, sortByStart } from "../rules";
import { shortClock, wibClockOf } from "../time";
import type { BoardItem, BoardTherapist } from "../types";
import { BOOKING_DRAG_TYPE, useBookingDnd } from "./use-booking-dnd";

const HEADER_H = 64;
const COL_W = 176;
const AXIS_W = 56;

export interface CalendarSlot {
  therapistId: string | null;
  /** "HH:MM" WIB. */
  time: string;
}

/**
 * Book Order — card "Belum ditugaskan" di kiri, kalender per terapis dengan
 * sumbu jam vertikal di kanan. Booking bisa diseret ke kolom
 * terapis untuk menugaskan atau kembali ke card untuk melepas terapis;
 * klik slot kosong untuk membuat booking.
 */
export function BookOrderCalendar({
  date,
  openTime,
  closeTime,
  therapists,
  unassigned,
  onOpenItem,
  onSlot,
  unassignedEmptyMessage = "Semua booking sudah punya terapis.",
}: {
  date: string;
  openTime?: string;
  closeTime?: string;
  therapists: BoardTherapist[];
  unassigned: BoardItem[];
  onOpenItem: (item: BoardItem) => void;
  onSlot: (slot: CalendarSlot) => void;
  unassignedEmptyMessage?: string;
}) {
  const dnd = useBookingDnd(unassigned, therapists);
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const all = useMemo(
    () => [...unassigned, ...therapists.flatMap((t) => t.items)].filter((i) => i.status !== "cancelled"),
    [unassigned, therapists]
  );
  const range = useMemo(() => dayRange(openTime, closeTime, all), [openTime, closeTime, all]);
  const height = (range.end - range.start) * PX_PER_MIN;
  const nowY = nowOffset(date, now, range);

  // Gulir ke jam sekarang (atau jam buka) saat tanggal berganti.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = nowY !== null ? Math.max(0, nowY - 160) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat tanggal/rentang berubah
  }, [date, range.start]);

  const hours = hourMarks(range);
  const unassignedItems = sortByStart(unassigned.filter((i) => i.status !== "cancelled"));

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card
        role="complementary"
        aria-label="Belum ditugaskan"
        className={cn("gap-0 border border-border py-0 shadow-none!", dnd.dropTarget === "unassigned" && "bg-accent/10 ring-2 ring-accent ring-inset")}
        onDragOver={(e) => dnd.onDragOver(e, "unassigned")}
        onDragLeave={(e) => dnd.onDragLeave(e, "unassigned")}
        onDrop={(e) => dnd.onDrop(e, null)}
      >
        <div className="space-y-1 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Belum ditugaskan</h2>
            <Badge variant={unassignedItems.length ? "warning" : "muted"}>{unassignedItems.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Seret booking ke kolom terapis untuk menugaskan seluruh treatment. Seret kembali ke sini untuk melepas terapis.</p>
        </div>
        <div className="max-h-[calc(100dvh-20rem)] overflow-y-auto p-4">
          {unassignedItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{unassignedEmptyMessage}</p>
          ) : (
            <ul className="space-y-2">
              {unassignedItems.map((item) => (
                <li key={item.id}>
                  <ItemButton item={item} onOpen={onOpenItem} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div role="region" aria-label="Jadwal terapis" className="min-w-0 overflow-hidden rounded-card border border-border bg-card shadow-none">
        <div ref={scroller} className="relative max-h-[calc(100dvh-15rem)] min-h-[28rem] overflow-auto">
          <div className="relative flex" style={{ height: height + HEADER_H }}>
            {/* Sumbu jam */}
            <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-card" style={{ width: AXIS_W }}>
              <div className="sticky top-0 z-10 border-b border-border bg-card" style={{ height: HEADER_H }} />
              <div className="relative" style={{ height }}>
                {hours.map((m) => (
                  <span
                    key={m}
                    className={cn(
                      "absolute right-2 text-[11px] font-medium tabular-nums text-muted-foreground",
                      m === range.start ? "translate-y-0.5" : "-translate-y-1/2"
                    )}
                    style={{ top: (m - range.start) * PX_PER_MIN }}
                  >
                    {m < range.end ? clockOf(m) : ""}
                  </span>
                ))}
              </div>
            </div>

            {therapists.map((row) => {
              const t = row.therapist;
              const unavailable = Boolean(row.on_leave || row.day_off);
              const placed = layoutColumn(row.items.filter((i) => i.status !== "cancelled"), range);
              const bands = offShiftBands(row.shift, unavailable, range);
              return (
                <Column
                  key={t.id}
                  header={
                    <div className="flex min-w-0 w-full items-center gap-2">
                      <TherapistAvatar therapist={t} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold" title={t.full_name}>{t.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.on_leave ? (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <UserRoundX className="size-3" /> Cuti
                            </span>
                          ) : row.day_off ? (
                            "Libur"
                          ) : row.shift ? (
                            `${shortClock(row.shift.start_time)}–${shortClock(row.shift.end_time)}`
                          ) : (
                            "Tanpa shift"
                          )}
                          {" · "}
                          {genderLabel(t.gender)}
                          {row.assisting ? " · Perbantuan" : ""}
                        </p>
                      </div>
                    </div>
                  }
                  width={COL_W}
                  range={range}
                  hours={hours}
                  nowY={nowY}
                  bands={bands}
                  highlight={dnd.dropTarget === t.id}
                  onDragOver={(e) => dnd.onDragOver(e, t.id)}
                  onDragLeave={(e) => dnd.onDragLeave(e, t.id)}
                  onDrop={(e) => dnd.onDrop(e, row)}
                  onEmptyClick={(minute) => onSlot({ therapistId: t.id, time: clockOf(minute) })}
                >
                  {placed.map((p) => (
                    <Block key={p.item.id} placed={p} onOpen={onOpenItem} />
                  ))}
                </Column>
              );
            })}
          </div>
        </div>
        <Legend />
      </div>
      {dnd.confirmation}
    </div>
  );
}

function TherapistAvatar({ therapist }: { therapist: BoardTherapist["therapist"] }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photoUrl = therapist.photo_url?.trim();
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-xs font-semibold text-brand-text">
      {photoUrl && photoUrl !== failedPhoto ? (
        <Image
          src={photoUrl}
          alt={`Foto ${therapist.full_name}`}
          width={32}
          height={32}
          unoptimized
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailedPhoto(photoUrl)}
        />
      ) : (
        <span aria-hidden>{initials(therapist.full_name) || "?"}</span>
      )}
    </span>
  );
}

function Column({
  header,
  width,
  range,
  hours,
  nowY,
  bands = [],
  highlight,
  className,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
  onEmptyClick,
}: {
  header: React.ReactNode;
  width: number;
  range: DayRange;
  hours: number[];
  nowY: number | null;
  bands?: { top: number; height: number }[];
  highlight?: boolean;
  className?: string;
  children: React.ReactNode;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onEmptyClick?: (minute: number) => void;
}) {
  const height = (range.end - range.start) * PX_PER_MIN;
  const [hoverMinute, setHoverMinute] = useState<number | null>(null);
  return (
    <div className={cn("relative shrink-0 border-r border-border", className)} style={{ width }}>
      <div
        className="sticky top-0 z-20 flex items-center border-b border-border bg-card/95 px-3 backdrop-blur"
        style={{ height: HEADER_H }}
      >
        {header}
      </div>
      <div
        className={cn("relative", onEmptyClick && "cursor-cell", highlight && "bg-accent/10 ring-2 ring-accent ring-inset")}
        style={{ height }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onMouseMove={(e) => {
          if (!onEmptyClick || e.target !== e.currentTarget) {
            setHoverMinute(null);
            return;
          }
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          setHoverMinute(minuteAtOffset(y, range));
        }}
        onMouseLeave={() => setHoverMinute(null)}
        onClick={(e) => {
          if (!onEmptyClick || e.target !== e.currentTarget) return;
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          onEmptyClick(minuteAtOffset(y, range));
        }}
      >
        {bands.map((b, i) => (
          <div
            key={i}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-muted/50 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,color-mix(in_srgb,var(--muted-foreground)_10%,transparent)_6px,color-mix(in_srgb,var(--muted-foreground)_10%,transparent)_8px)]"
            style={{ top: b.top, height: b.height }}
          />
        ))}
        {hours.map((m) => (
          <div
            key={m}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-border/70"
            style={{ top: (m - range.start) * PX_PER_MIN }}
          />
        ))}
        {hours.slice(0, -1).map((m) => (
          <div
            key={`h${m}`}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/40"
            style={{ top: (m + 30 - range.start) * PX_PER_MIN }}
          />
        ))}
        {nowY !== null && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: nowY }} />
        )}
        {hoverMinute !== null && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent-strong"
            style={{ top: (hoverMinute - range.start) * PX_PER_MIN }}>
            <span className="absolute top-1 right-1 rounded bg-accent-strong px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent-foreground shadow-sm">
              {clockOf(hoverMinute)}
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const BLOCK_TONE: Record<string, string> = {
  unassigned: "border-warning bg-warning-soft text-foreground border-dashed",
  assigned: "border-accent-strong/70 bg-accent-soft text-foreground",
  in_treatment: "border-blue-700 bg-blue-600 text-white",
  completed: "border-success/40 bg-success-soft text-foreground",
};

function Block({ placed, onOpen }: { placed: Placed<BoardItem>; onOpen: (item: BoardItem) => void }) {
  const { item, top, height, bufferHeight, lane, lanes } = placed;
  const widthPct = 100 / lanes;
  return (
    <div
      className="absolute z-[5] px-1"
      style={{ top, left: `${lane * widthPct}%`, width: `${widthPct}%`, height: height + bufferHeight }}
    >
      <ItemButton item={item} height={height} onOpen={onOpen} />
    </div>
  );
}

function ItemButton({ item, height, onOpen }: { item: BoardItem; height?: number; onOpen: (item: BoardItem) => void }) {
  const draggable = isDraggable(item);
  const compact = height !== undefined && height < 44;
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(BOOKING_DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(item)}
      title={`${wibClockOf(item.starts_at)}–${wibClockOf(item.ends_at)} · ${item.customer_name} · ${item.treatment_name} (${item.variant_name})`}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border px-2 py-1 text-left text-xs transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        height === undefined && "gap-1 px-3 py-3",
        BLOCK_TONE[item.status] ?? "border-border bg-muted",
        item.status === "in_treatment" ? "hover:bg-blue-700" : "hover:bg-surface",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      )}
      style={{ height }}
    >
      <span className="font-semibold tabular-nums">
        {wibClockOf(item.starts_at)}–{wibClockOf(item.ends_at)}
        {compact ? ` · ${item.customer_name}` : ""}
      </span>
      {!compact && <span className="truncate font-medium">{item.customer_name}</span>}
      {!compact && (height === undefined || height >= 62) && (
        <span className="truncate opacity-80">
          {item.treatment_name} · {item.variant_name}
        </span>
      )}
    </button>
  );
}

function Legend() {
  const chips: [string, string][] = [
    ["Belum ditugaskan", BLOCK_TONE.unassigned],
    ["Ditugaskan", BLOCK_TONE.assigned],
    ["Sedang treatment", BLOCK_TONE.in_treatment],
    ["Selesai", BLOCK_TONE.completed],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      {chips.map(([label, tone]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block size-3 rounded border", tone)} /> {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-4 rounded bg-muted/50 bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,color-mix(in_srgb,var(--muted-foreground)_30%,transparent)_2px,color-mix(in_srgb,var(--muted-foreground)_30%,transparent)_4px)]" />
        Di luar shift
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-danger" /> Sekarang
      </span>
      <span className="ml-auto hidden sm:inline">Seret blok ke kolom terapis untuk menugaskan · klik slot kosong untuk booking baru</span>
    </div>
  );
}
