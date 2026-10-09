"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  availabilityWarning,
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
import { useItemAction } from "../mutations";
import { genderLabel } from "../rules";
import { shortClock, wibClockOf } from "../time";
import type { BoardItem, BoardTherapist } from "../types";

const HEADER_H = 64;
const COL_W = 176;
const AXIS_W = 56;
const DRAG_TYPE = "application/x-mizu-item";

export interface CalendarSlot {
  therapistId: string | null;
  /** "HH:MM" WIB. */
  time: string;
}

/**
 * Book Order — tampilan kalender per terapis: satu kolom per terapis (plus
 * kolom "Belum ditugaskan"), sumbu jam vertikal. Blok bisa diseret ke kolom
 * terapis untuk menugaskan; klik slot kosong untuk membuat booking.
 */
export function BookOrderCalendar({
  date,
  openTime,
  closeTime,
  therapists,
  unassigned,
  onOpenItem,
  onSlot,
}: {
  date: string;
  openTime?: string;
  closeTime?: string;
  therapists: BoardTherapist[];
  unassigned: BoardItem[];
  onOpenItem: (item: BoardItem) => void;
  onSlot: (slot: CalendarSlot) => void;
}) {
  const action = useItemAction();
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: BoardItem; row: BoardTherapist; warning: string } | null>(null);

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
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);

  // Gulir ke jam sekarang (atau jam buka) saat tanggal berganti.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = nowY !== null ? Math.max(0, nowY - 160) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat tanggal/rentang berubah
  }, [date, range.start]);

  const assign = (item: BoardItem, therapist: BoardTherapist) =>
    action.mutate(
      { bookingId: item.booking_id, itemId: item.id, input: { action: "assign", therapist_id: therapist.therapist.id } },
      {
        onSuccess: () =>
          toast.success("Terapis ditugaskan", {
            description: `${item.customer_name} · ${wibClockOf(item.starts_at)} → ${therapist.therapist.full_name}`,
          }),
        onError: (err) => toast.error("Gagal menugaskan", { description: err.message }),
      }
    );

  // Seret ke kolom terapis: di luar shift/cuti/libur minta konfirmasi dulu.
  const drop = (itemId: string, row: BoardTherapist) => {
    const item = byId.get(itemId);
    if (!item || item.therapist_id === row.therapist.id) return;
    if (!isDraggable(item)) {
      toast.error("Treatment ini sudah berjalan atau selesai, tidak bisa dipindah.");
      return;
    }
    const warning = availabilityWarning(item, row);
    if (warning) setPending({ item, row, warning });
    else assign(item, row);
  };

  const onDrop = (e: DragEvent, therapist: BoardTherapist) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id) drop(id, therapist);
  };

  const hours = hourMarks(range);
  const unassignedPlaced = layoutColumn(unassigned.filter((i) => i.status !== "cancelled"), range);
  const unassignedLanes = Math.max(1, ...unassignedPlaced.map((p) => p.lanes));

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-card">
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

          {/* Belum ditugaskan */}
          <Column
            header={
              <div>
                <p className="font-semibold text-warning">Belum ditugaskan</p>
                <p className="text-xs text-muted-foreground">{unassignedPlaced.length} treatment</p>
              </div>
            }
            width={Math.max(COL_W, unassignedLanes * 132)}
            range={range}
            hours={hours}
            nowY={nowY}
            className="bg-warning-soft/40"
          >
            {unassignedPlaced.map((p) => (
              <Block key={p.item.id} placed={p} onOpen={onOpenItem} />
            ))}
          </Column>

          {therapists.map((row) => {
            const t = row.therapist;
            const unavailable = Boolean(row.on_leave || row.day_off);
            const placed = layoutColumn(row.items.filter((i) => i.status !== "cancelled"), range);
            const bands = offShiftBands(row.shift, unavailable, range);
            return (
              <Column
                key={t.id}
                header={
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{t.full_name}</p>
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
                }
                width={COL_W}
                range={range}
                hours={hours}
                nowY={nowY}
                bands={bands}
                highlight={dropTarget === t.id}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTarget(t.id);
                }}
                onDragLeave={() => setDropTarget((cur) => (cur === t.id ? null : cur))}
                onDrop={(e) => onDrop(e, row)}
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
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Tugaskan ke ${pending?.row.therapist.full_name ?? ""}?`}
        description={`${pending?.warning ?? ""} Tetap tugaskan ${pending?.item.customer_name ?? ""}?`}
        confirmLabel="Tetap tugaskan"
        onConfirm={() => {
          if (pending) assign(pending.item, pending.row);
          setPending(null);
        }}
      />
    </div>
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
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
  onEmptyClick?: (minute: number) => void;
}) {
  const height = (range.end - range.start) * PX_PER_MIN;
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
            className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,color-mix(in_srgb,var(--muted-foreground)_10%,transparent)_6px,color-mix(in_srgb,var(--muted-foreground)_10%,transparent)_8px)]"
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
        {children}
      </div>
    </div>
  );
}

const BLOCK_TONE: Record<string, string> = {
  unassigned: "border-warning bg-warning-soft text-foreground border-dashed",
  assigned: "border-accent-strong/70 bg-accent-soft text-foreground",
  in_treatment: "border-accent-dark bg-accent-strong text-accent-foreground",
  completed: "border-success/40 bg-success-soft text-foreground",
};

function Block({ placed, onOpen }: { placed: Placed<BoardItem>; onOpen: (item: BoardItem) => void }) {
  const { item, top, height, bufferHeight, lane, lanes } = placed;
  const draggable = isDraggable(item);
  const widthPct = 100 / lanes;
  const compact = height < 44;
  return (
    <div
      className="absolute z-[5] px-1"
      style={{ top, left: `${lane * widthPct}%`, width: `${widthPct}%`, height: height + bufferHeight }}
    >
      <button
        type="button"
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, item.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onOpen(item)}
        title={`${wibClockOf(item.starts_at)}–${wibClockOf(item.ends_at)} · ${item.customer_name} · ${item.treatment_name} (${item.variant_name})`}
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-lg border px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          BLOCK_TONE[item.status] ?? "border-border bg-muted",
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        )}
        style={{ height }}
      >
        <span className="font-semibold tabular-nums">
          {wibClockOf(item.starts_at)}–{wibClockOf(item.ends_at)}
          {compact ? ` · ${item.customer_name}` : ""}
        </span>
        {!compact && <span className="truncate font-medium">{item.customer_name}</span>}
        {!compact && height >= 62 && (
          <span className="truncate opacity-80">
            {item.treatment_name} · {item.variant_name}
          </span>
        )}
      </button>
      {bufferHeight > 0 && (
        <div
          aria-hidden
          title={`Jeda ${item.buffer_min} menit`}
          className="mx-1 rounded-b-md bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,color-mix(in_srgb,var(--muted-foreground)_18%,transparent)_3px,color-mix(in_srgb,var(--muted-foreground)_18%,transparent)_5px)]"
          style={{ height: bufferHeight }}
        />
      )}
    </div>
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
        <span className="inline-block h-3 w-4 rounded bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,color-mix(in_srgb,var(--muted-foreground)_30%,transparent)_2px,color-mix(in_srgb,var(--muted-foreground)_30%,transparent)_4px)]" />
        Jeda / di luar shift
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-danger" /> Sekarang
      </span>
      <span className="ml-auto hidden sm:inline">Seret blok ke kolom terapis untuk menugaskan · klik slot kosong untuk booking baru</span>
    </div>
  );
}
