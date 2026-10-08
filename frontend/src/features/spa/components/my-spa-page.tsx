"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { todayWib } from "@/lib/dates";
import { formatDateLong, formatDateTime, formatNumber, formatRupiah, formatTime } from "@/lib/format";
import { useMyAssignmentAction } from "../mutations";
import { useMyAssignments, useMyCommissions, useSpaMe } from "../queries";
import { isBookingClosed, sortByStart, sumCommission } from "../rules";
import { currentMonthWib } from "../time";
import type { BoardItem } from "../types";
import { ItemStatusBadge, SPA_KICKER, TimeRange } from "./shared";

/** Area Karyawan → Tugas Terapis: jadwal hari ini, mulai/selesai dari HP, komisi bulan ini. */
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

function TherapistHome({ name, branch }: { name: string; branch: string | null }) {
  const [date, setDate] = useState(() => todayWib());
  const [month] = useState(() => currentMonthWib());
  const assignments = useMyAssignments(date);
  const commissions = useMyCommissions(month);
  const items = sortByStart((assignments.data ?? []).filter((i) => i.status !== "cancelled"));
  const lines = commissions.data ?? [];
  const pending = items.filter((i) => i.status === "assigned" || i.status === "in_treatment").length;

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <PageHeader
        kicker={`${SPA_KICKER} · Tugas Terapis`}
        title={`Halo, ${name.split(" ")[0]}`}
        description={branch ? `Outlet asal ${branch}. Tekan Mulai saat treatment dimulai dan Selesai saat sudah selesai.` : undefined}
        className="mb-2"
      />

      <div className="flex items-center gap-3">
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Tanggal tugas"
          className="w-44"
        />
        <p className="text-sm text-muted-foreground">
          {formatNumber(items.length)} tugas{pending ? ` · ${pending} belum selesai` : ""}
        </p>
      </div>

      {assignments.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : assignments.error ? (
        <Card className="px-5">
          <p className="text-sm text-danger">{assignments.error.message}</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="px-5 text-center">
          <p className="py-6 text-sm text-muted-foreground">Tidak ada tugas pada {formatDateLong(date)}.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <AssignmentCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      <Card className="gap-3 px-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-body/80">Komisi bulan ini</p>
            <p className="text-[28px] leading-tight font-extrabold tabular-nums">
              {commissions.isLoading ? "…" : formatRupiah(sumCommission(lines))}
            </p>
          </div>
          <Badge variant="muted">{formatNumber(lines.length)} treatment</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Hanya treatment selesai dari booking yang sudah lunas.</p>
        {commissions.error ? (
          <p className="text-sm text-danger">{commissions.error.message}</p>
        ) : lines.length > 0 ? (
          <ul className="divide-y divide-border">
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
        ) : null}
      </Card>
    </div>
  );
}

function AssignmentCard({ item }: { item: BoardItem }) {
  const action = useMyAssignmentAction();
  const closed = isBookingClosed({ status: item.booking_status });
  const run = (kind: "start" | "complete") =>
    action.mutate(
      { itemId: item.id, action: kind },
      {
        onSuccess: () => toast.success(kind === "start" ? "Treatment dimulai" : "Treatment selesai", { description: item.customer_name }),
        onError: (err) => toast.error(kind === "start" ? "Gagal memulai" : "Gagal menyelesaikan", { description: err.message }),
      }
    );

  return (
    <li>
      <Card className="gap-3 px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <TimeRange start={item.starts_at} end={item.ends_at} className="text-xl font-bold" />
            <p className="mt-1 font-semibold">{item.customer_name}</p>
            <p className="text-sm text-muted-foreground">
              {item.treatment_name} — {item.variant_name} · {item.duration_min} mnt
            </p>
            <p className="font-mono text-xs text-muted-foreground">{item.booking_code}</p>
          </div>
          <ItemStatusBadge status={item.status} />
        </div>
        {!closed && item.status === "assigned" && (
          <Button size="lg" className="w-full" disabled={action.isPending} onClick={() => run("start")}>
            <PlayCircle className="size-5" /> Mulai
          </Button>
        )}
        {!closed && item.status === "in_treatment" && (
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
      </Card>
    </li>
  );
}
