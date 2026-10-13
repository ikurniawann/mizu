"use client";

import { useState } from "react";
import { CalendarOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateLong } from "@/lib/format";
import { useBookMyDayOff, useCancelMyDayOff } from "../mutations";
import { useMyDayOffs } from "../queries";
import { currentMonthWib } from "../time";
import type { DayOffDay } from "../types";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Aplikasi terapis → Jadwal libur (revisi R5): pilih hari libur bulan ini /
 * bulan depan. Disetujui langsung bila kuota terapis wanita/pria yang masuk
 * di outlet tetap terpenuhi dan libur minggu itu belum penuh; siapa cepat dia dapat.
 */
export function MyDayOffCard() {
  const [thisMonth] = useState(() => currentMonthWib());
  const [month, setMonth] = useState(thisMonth);
  const [picked, setPicked] = useState<string | null>(null);
  const data = useMyDayOffs(month);
  const book = useBookMyDayOff();
  const cancel = useCancelMyDayOff();
  const days = data.data?.days ?? [];
  const quota = data.data?.quota;
  const lead = days.length ? days[0].weekday - 1 : 0;
  const day = days.find((d) => d.date === picked) ?? null;
  const mine = days.filter((d) => d.mine === "requested").length;

  const onBook = (d: DayOffDay) =>
    book.mutate(d.date, {
      onSuccess: () => toast.success("Libur disetujui", { description: formatDateLong(d.date) }),
      onError: (err) => toast.error("Libur ditolak", { description: err.message }),
    });
  const onCancel = (d: DayOffDay) =>
    d.request_id &&
    cancel.mutate(d.request_id, {
      onSuccess: () => toast.success("Libur dibatalkan", { description: formatDateLong(d.date) }),
      onError: (err) => toast.error("Gagal membatalkan", { description: err.message }),
    });

  return (
    <Card className="gap-3 px-5" id="libur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <CalendarOff className="size-5 text-muted-foreground" /> Jadwal libur
          </p>
          <p className="text-xs text-muted-foreground">
            Pilih hari liburmu. Maksimal {quota?.max_per_week ?? 2} hari per minggu (termasuk libur tetap dari jadwal shift). Siapa cepat dia dapat; ditolak bila
            terapis {quota && (quota.min_female > 0 || quota.min_male > 0) ? `wanita (min ${quota.min_female}) atau pria (min ${quota.min_male})` : ""} yang masuk jadi kurang.
          </p>
        </div>
      </div>
      <div className="flex gap-2" role="tablist" aria-label="Bulan">
        {[thisMonth, nextMonth(thisMonth)].map((m) => (
          <Button key={m} size="sm" variant={m === month ? "default" : "outline"} role="tab" aria-selected={m === month} onClick={() => { setMonth(m); setPicked(null); }}>
            {monthLabel(m)}
          </Button>
        ))}
        {mine > 0 && <Badge variant="accent" className="ml-auto self-center">{mine} hari libur</Badge>}
      </div>
      {data.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.error ? (
        <p className="text-sm text-danger">{data.error.message}</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => setPicked(d.date)}
                aria-label={`${formatDateLong(d.date)}${d.mine === "requested" ? ", libur" : d.can_book ? ", bisa diajukan" : ""}`}
                aria-pressed={picked === d.date}
                className={cn(
                  "flex h-11 flex-col items-center justify-center rounded-lg text-sm tabular-nums transition",
                  d.mine === "requested" && "bg-accent-strong font-bold text-accent-foreground",
                  (d.mine === "pattern" || d.mine === "leave") && "bg-surface-2 text-muted-foreground",
                  !d.mine && d.can_book && "bg-surface hover:bg-surface-2",
                  !d.mine && !d.can_book && "text-muted-foreground/60",
                  picked === d.date && "ring-2 ring-forest dark:ring-accent",
                )}
              >
                {Number(d.date.slice(8))}
                <span className="text-[9px] leading-none font-medium">
                  {d.mine === "requested" ? "Libur" : d.mine === "pattern" ? "Off" : d.mine === "leave" ? "Cuti" : ""}
                </span>
              </button>
            ))}
          </div>
          {day ? (
            <div className="space-y-2 rounded-2xl bg-surface px-4 py-3 text-sm" role="status">
              <p className="font-semibold">{formatDateLong(day.date)}</p>
              <p className="text-xs text-muted-foreground">
                Masuk di outlet: {day.working_female} wanita · {day.working_male} pria{day.off_count ? ` · ${day.off_count} terapis libur` : ""}
              </p>
              {day.mine === "requested" ? (
                <Button variant="outline" className="w-full" disabled={cancel.isPending} onClick={() => onCancel(day)}>
                  Batalkan libur ini
                </Button>
              ) : day.mine === "pattern" ? (
                <p className="text-body">Hari ini sudah libur tetap di jadwal shift kamu.</p>
              ) : day.mine === "leave" ? (
                <p className="text-body">Kamu sedang cuti pada tanggal ini.</p>
              ) : day.can_book ? (
                <Button className="w-full" disabled={book.isPending} onClick={() => onBook(day)}>
                  Ajukan libur
                </Button>
              ) : (
                <p className="text-warning">Belum bisa libur: {day.reason}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Ketuk tanggal untuk mengajukan atau membatalkan libur.</p>
          )}
        </>
      )}
    </Card>
  );
}
