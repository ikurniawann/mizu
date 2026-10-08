"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { todayWib } from "@/lib/dates";
import { addDaysToDate } from "../time";
import { call, withQuery } from "../api";

type Stage = { step: string; reached: number; abandoned: number };
const LABEL: Record<string, string> = {
  open: "Buka booking", outlet: "Pilih outlet", treatment: "Pilih treatment",
  time: "Pilih waktu", contact: "Isi kontak", submit: "Kirim booking", success: "Berhasil",
};

export function BookingFunnelCard() {
  const [today] = useState(() => todayWib());
  const [from, setFrom] = useState(() => addDaysToDate(today, -6));
  const [to, setTo] = useState(today);
  const valid = from <= to;
  const report = useQuery({
    queryKey: ["spa", "booking-funnel", from, to],
    queryFn: () => call<Stage[]>(withQuery("/api/spa/booking-funnel", { from, to })),
    enabled: valid,
  });
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Alur booking online</h2>
          <p className="text-xs text-muted-foreground">Sesi anonim per langkah. “Berhenti” dihitung setelah 30 menit tanpa langkah berikutnya.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} aria-label="Awal laporan booking" className="rounded-lg border border-border bg-card px-2 py-1" />
          <span>–</span>
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} aria-label="Akhir laporan booking" className="rounded-lg border border-border bg-card px-2 py-1" />
        </div>
      </div>
      {!valid ? <p className="text-sm text-danger">Rentang tanggal tidak valid.</p> : report.isLoading ? <p className="text-sm text-muted-foreground">Memuat alur…</p> : report.error ? <p className="text-sm text-danger">Laporan belum bisa dimuat.</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {(report.data ?? []).map((stage) => (
            <div key={stage.step} className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{LABEL[stage.step] ?? stage.step}</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{stage.reached}</p>
              {stage.step !== "success" && <p className="text-xs text-muted-foreground">{stage.abandoned} berhenti</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
