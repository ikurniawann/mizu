"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/format";
import { trainingStatusLabel, useMyTrainings } from "../training";
import { FormError, TableNote } from "./shared";

export function MyTrainingPage() {
  const mine = useMyTrainings();
  const data = mine.data;
  return <div className="space-y-4">
    <PageHeader kicker="Area Karyawan" title="Training Saya" description="Jadwal, keikutsertaan, hasil training, dan progres kenaikan level Anda." />
    {mine.isLoading ? <TableNote>Memuat training…</TableNote> : mine.error ? <FormError>{mine.error.message}</FormError> : !data?.therapist ? <TableNote>Akun Anda belum terdaftar sebagai terapis.</TableNote> : <>
      <Card className="gap-2 p-4"><p className="font-medium">{data.therapist.full_name}</p><p className="text-2xl font-semibold">Level {data.therapist.level}</p><p className="text-sm text-muted-foreground">Periode kerja {data.therapist.employment_cycle}. Kelulusan sebelum masuk kembali setelah resign tetap tersimpan sebagai riwayat.</p></Card>
      <h2 className="font-semibold">Syarat kenaikan level</h2>
      {data.therapist.level === 2 ? <p className="text-sm">Anda sudah mencapai Level 2.</p> : !data.progress.some((p) => p.target_level === data.therapist!.level + 1) ? <p className="text-sm text-muted-foreground">Syarat untuk level berikutnya belum diatur admin.</p> : <Card className="gap-3 p-4">{data.progress.filter((p) => p.target_level === data.therapist!.level + 1).map((p) => <div key={`${p.target_level}-${p.training_id}`} className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium">{p.training_name} — {p.period}</p><p className="text-xs text-muted-foreground">Untuk Level {p.target_level}</p></div><Badge variant={p.passed ? "success" : "muted"}>{p.passed ? "Terpenuhi" : "Belum terpenuhi"}</Badge>
      </div>)}</Card>}
      <h2 className="font-semibold">Keikutsertaan training</h2>
      {!data.participations.length && <p className="text-sm text-muted-foreground">Anda belum didaftarkan pada training.</p>}
      <div className="grid gap-3 lg:grid-cols-2">{data.participations.map((p) => <Card key={p.id} className="gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium">{p.training_name} — {p.period}</h3><Badge variant={p.status === "passed" ? "success" : "muted"}>{trainingStatusLabel[p.status]}</Badge></div>
        <p className="text-sm text-muted-foreground">{formatDate(p.training_date)} · Trainer: {p.trainer_name}</p>
        {p.employment_cycle !== data.therapist!.employment_cycle && <Badge variant="muted">Periode kerja sebelumnya</Badge>}
        {p.notes && <p className="whitespace-pre-wrap text-sm">{p.notes}</p>}
        {p.reviewed_at && <p className="text-xs text-muted-foreground">Dicatat oleh {p.reviewed_by ?? "Admin"} · {formatDate(p.reviewed_at)}</p>}
      </Card>)}</div>
      {data.history.length > 0 && <><h2 className="font-semibold">Riwayat level</h2><Card className="gap-3 p-4">{data.history.map((h, i) => <div key={i} className="text-sm"><p>Level {h.from_level} → Level {h.to_level} · {h.reason}</p><p className="text-xs text-muted-foreground">{formatDate(h.created_at)} · Periode kerja {h.employment_cycle}</p></div>)}</Card></>}
    </>}
  </div>;
}
