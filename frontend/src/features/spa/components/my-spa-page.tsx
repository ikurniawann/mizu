"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Hourglass, Loader2, PlayCircle, Plus, StickyNote, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { todayWib } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { formatDateLong, formatDateTime, formatNumber, formatRupiah, formatTime } from "@/lib/format";
import { useMyAssignmentAction } from "../mutations";
import { dayLabel, groupMySchedule, isNewAssignment, treatmentLabel, type MyBooking } from "../my-schedule";
import { useMyCommissions, useMySchedule, useMySummary, useSpaMe } from "../queries";
import { isBookingClosed } from "../rules";
import { currentMonthWib, wibDateOf } from "../time";
import type { MyScheduleItem } from "../types";
import { MyAddTreatmentDialog } from "./my-add-treatment-dialog";
import { ItemStatusBadge, SPA_KICKER, TimeRange } from "./shared";

/**
 * Area Karyawan → Tugas Terapis: booking yang ditugaskan (per tanggal & 14 hari
 * ke depan, ditandai "Baru"), mulai/selesai dari HP, komisi bulan ini (cair,
 * menunggu pembayaran, perkiraan dari jadwal) dan komisi per booking.
 */
export function MySpaPage() {
  const me = useSpaMe();

  if (me.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (me.error) {
    return <p className="mx-auto max-w-md py-20 text-center text-sm text-danger">{me.error.message}</p>;
  }
  if (!me.data?.therapist) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-lg font-semibold text-foreground">Akun Anda belum terdaftar sebagai terapis</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman ini untuk terapis Mizu. Minta admin spa menambahkan Anda di menu Spa → Terapis bila menurut Anda ini keliru.
        </p>
      </div>
    );
  }
  return <TherapistHome name={me.data.therapist.full_name} branch={me.data.therapist.home_branch_name} />;
}

const MONTH_NAME = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const SCHEDULE_DAYS = 14;

type View = "today" | "upcoming";

function TherapistHome({ name, branch }: { name: string; branch: string | null }) {
  const [view, setView] = useState<View>("today");
  const [date, setDate] = useState(() => todayWib());
  const [month] = useState(() => currentMonthWib());
  const [now] = useState(() => new Date());
  const today = todayWib();
  const day = useMySchedule(date, 1);
  const upcoming = useMySchedule(today, SCHEDULE_DAYS);
  const summary = useMySummary(month);
  const commissions = useMyCommissions(month);

  const dayBookings = groupMySchedule(day.data ?? [], today).flatMap((d) => d.bookings);
  const upcomingDays = groupMySchedule(upcoming.data ?? [], today);
  const fresh = upcomingDays.flatMap((d) => d.bookings).filter((b) => isNewAssignment(b, now));
  const pending = dayBookings.flatMap((b) => b.items).filter((i) => i.status === "assigned" || i.status === "in_treatment").length;
  const lines = commissions.data ?? [];
  const monthLabel = MONTH_NAME[Number(month.slice(5, 7)) - 1] ?? "";

  // /dashboard/me/spa#komisi (dari Beranda Karyawan): buka & tampilkan rincian komisi.
  const komisi = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== "#komisi" || !komisi.current) return;
      komisi.current.open = true;
      komisi.current.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <PageHeader
        kicker={`${SPA_KICKER} · Tugas Terapis`}
        title={`Halo, ${name.split(" ")[0]}`}
        description={branch ? `Outlet asal ${branch}. Tekan Mulai saat treatment dimulai dan Selesai saat sudah selesai.` : undefined}
        className="mb-2"
      />

      {fresh.length > 0 && (
        <button
          type="button"
          onClick={() => setView("upcoming")}
          className="flex w-full items-center gap-3 rounded-card bg-accent-soft px-4 py-3 text-left text-sm transition hover:bg-accent/20"
        >
          <BellRing className="size-5 shrink-0 text-forest dark:text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{fresh.length} booking baru untukmu</span>
            <span className="block truncate text-xs text-body">
              {fresh
                .slice(0, 3)
                .map((b) => `${dayLabel(wibDateOf(b.starts_at), today)} ${shortTime(b.starts_at)} · ${b.customer_name}`)
                .join(" — ")}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      <Card className="gap-4 px-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-body/80">Komisi {monthLabel}</p>
            <p className="text-[28px] leading-tight font-extrabold tabular-nums">
              {summary.isLoading ? "…" : formatRupiah(summary.data?.earned_idr ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Sudah cair: treatment selesai & booking lunas</p>
          </div>
          <Wallet className="size-8 text-accent-strong" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            icon={Hourglass}
            label="Menunggu pembayaran"
            value={summary.data?.pending_idr}
            count={summary.data?.pending_count}
            hint="Selesai, booking belum lunas"
          />
          <MiniStat
            icon={CalendarClock}
            label="Perkiraan dari jadwal"
            value={summary.data?.upcoming_idr}
            count={summary.data?.upcoming_count}
            hint="Treatment terjadwal bulan ini"
          />
        </div>
        {summary.error && <p className="text-sm text-danger">{summary.error.message}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-1 rounded-full bg-card p-1 shadow-card" role="tablist" aria-label="Tampilan tugas">
        {(
          [
            ["today", "Per tanggal"],
            ["upcoming", `Jadwal ${SCHEDULE_DAYS} hari`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={cn(
              "h-10 rounded-full text-sm font-semibold transition",
              view === key ? "bg-ink text-on-ink" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "today" ? (
        <>
          <div className="flex items-center gap-3">
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Tanggal tugas"
              className="w-44"
            />
            <p className="text-sm text-muted-foreground">
              {formatNumber(dayBookings.length)} booking{pending ? ` · ${pending} treatment belum selesai` : ""}
            </p>
          </div>
          <ScheduleState query={day} empty={`Tidak ada tugas pada ${formatDateLong(date)}.`} count={dayBookings.length}>
            <ul className="space-y-3">
              {dayBookings.map((b) => (
                <BookingCard key={b.booking_id} booking={b} isNew={isNewAssignment(b, now)} actions={wibDateOf(b.starts_at) === today} />
              ))}
            </ul>
          </ScheduleState>
        </>
      ) : (
        <ScheduleState query={upcoming} empty={`Belum ada booking untukmu ${SCHEDULE_DAYS} hari ke depan.`} count={upcomingDays.length}>
          <div className="space-y-5">
            {upcomingDays.map((d) => (
              <section key={d.date} className="space-y-2">
                <h2 className="flex items-baseline justify-between text-sm font-semibold">
                  <span>{d.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {d.bookings.length} booking · {formatRupiah(d.bookings.reduce((s, b) => s + b.commission_idr, 0))}
                  </span>
                </h2>
                <ul className="space-y-3">
                  {d.bookings.map((b) => (
                    <BookingCard key={b.booking_id} booking={b} isNew={isNewAssignment(b, now)} actions={d.date === today} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScheduleState>
      )}

      <details ref={komisi} id="komisi" className="group scroll-mt-24 rounded-card bg-card px-5 py-4 shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-sm font-semibold">Rincian komisi cair {monthLabel}</span>
          <span className="flex items-center gap-2">
            <Badge variant="muted">{formatNumber(lines.length)} treatment</Badge>
            <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
          </span>
        </summary>
        {commissions.error ? (
          <p className="mt-3 text-sm text-danger">{commissions.error.message}</p>
        ) : lines.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Belum ada komisi cair bulan ini.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {[...lines]
              .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
              .map((l) => (
                <li key={l.item_id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {l.treatment_name} — {l.variant_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(l.completed_at)} · {l.branch_name} · <span className="font-mono">{l.booking_code}</span>
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatRupiah(l.commission_idr)}</span>
                </li>
              ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function shortTime(iso: string): string {
  return formatTime(iso).replace(":", ".");
}

function MiniStat({
  icon: Icon,
  label,
  value,
  count,
  hint,
}: {
  icon: typeof Wallet;
  label: string;
  value: number | undefined;
  count: number | undefined;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-body">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value === undefined ? "…" : formatRupiah(value)}</p>
      <p className="text-[11px] text-muted-foreground">
        {count ? `${formatNumber(count)} treatment · ` : ""}
        {hint}
      </p>
    </div>
  );
}

function ScheduleState({
  query,
  empty,
  count,
  children,
}: {
  query: { isLoading: boolean; error: Error | null };
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (query.error) {
    return (
      <Card className="px-5">
        <p className="text-sm text-danger">{query.error.message}</p>
      </Card>
    );
  }
  if (count === 0) {
    return (
      <Card className="px-5 text-center">
        <p className="py-6 text-sm text-muted-foreground">{empty}</p>
      </Card>
    );
  }
  return <>{children}</>;
}

/** Satu booking: jam, tamu, treatment (dengan tombol Mulai/Selesai bila hari ini), catatan, komisi. */
function BookingCard({ booking, isNew, actions }: { booking: MyBooking; isNew: boolean; actions: boolean }) {
  const closed = isBookingClosed({ status: booking.booking_status });
  const [adding, setAdding] = useState(false);
  // Tamu bisa minta treatment tambahan sebelum, saat, atau setelah treatment — selama belum dibayar (revisi R4).
  const canAdd = actions && !closed && booking.payment_status === "unpaid";
  return (
    <li>
      <Card className={cn("gap-3 px-5", isNew && "ring-2 ring-accent-strong")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <TimeRange start={booking.starts_at} end={booking.ends_at} className="text-xl font-bold" />
            <p className="mt-1 font-semibold">{booking.customer_name}</p>
            <p className="text-xs text-muted-foreground">
              {booking.branch_name} · <span className="font-mono">{booking.booking_code}</span>
            </p>
          </div>
          {isNew ? <Badge variant="accent">Baru</Badge> : null}
        </div>
        <ul className="space-y-2">
          {booking.items.map((item) => (
            <TreatmentRow key={item.id} item={item} actions={actions && !closed} />
          ))}
        </ul>
        {canAdd && (
          <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Tambah treatment
          </Button>
        )}
        {adding && (
          <MyAddTreatmentDialog bookingId={booking.booking_id} branchId={booking.branch_id} customerName={booking.customer_name} onClose={() => setAdding(false)} />
        )}
        {booking.notes.trim() && (
          <p className="flex gap-2 rounded-xl bg-surface px-3 py-2 text-sm text-body">
            <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{booking.notes}</span>
          </p>
        )}
        <p className="flex items-center justify-between border-t border-dashed border-border pt-3 text-sm">
          <span className="text-body">{booking.estimated ? "Perkiraan komisi" : "Komisi"}</span>
          <span className="font-semibold tabular-nums">{formatRupiah(booking.commission_idr)}</span>
        </p>
      </Card>
    </li>
  );
}

function TreatmentRow({ item, actions }: { item: MyScheduleItem; actions: boolean }) {
  const action = useMyAssignmentAction();
  const run = (kind: "start" | "complete") =>
    action.mutate(
      { itemId: item.id, action: kind },
      {
        onSuccess: () => toast.success(kind === "start" ? "Treatment dimulai" : "Treatment selesai", { description: item.customer_name }),
        onError: (err) => toast.error(kind === "start" ? "Gagal memulai" : "Gagal menyelesaikan", { description: err.message }),
      }
    );
  return (
    <li className="space-y-2 rounded-2xl border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{treatmentLabel(item)}</p>
        <ItemStatusBadge status={item.status} />
      </div>
      {actions && item.status === "assigned" && (
        <Button size="lg" className="w-full" disabled={action.isPending} onClick={() => run("start")}>
          <PlayCircle className="size-5" /> Mulai
        </Button>
      )}
      {actions && item.status === "in_treatment" && (
        <>
          {item.started_at && <p className="text-xs text-muted-foreground">Dimulai {formatTime(item.started_at)}</p>}
          <Button size="lg" variant="ink" className="w-full" disabled={action.isPending} onClick={() => run("complete")}>
            <CheckCircle2 className="size-5" /> Selesai
          </Button>
        </>
      )}
      {item.status === "completed" && item.completed_at && (
        <p className="text-xs text-success">Selesai {formatTime(item.completed_at)}</p>
      )}
    </li>
  );
}
