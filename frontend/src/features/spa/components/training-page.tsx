"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelForm, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import { todayWib } from "@/lib/dates";
import { useTrainings, useSaveTraining, type Training, type TrainingInput } from "../training";
import { LevelSettings } from "./level-settings";
import { TrainingDetail } from "./training-detail";
import { Field, FormError, TableNote, TEXTAREA } from "./shared";

export function SpaTrainingPage({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const trainings = useTrainings();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Training | "new" | null>(null);
  const [search, setSearch] = useState("");
  const rows = (trainings.data ?? []).filter((t) => `${t.name} ${t.topic_code} ${t.period}`.toLowerCase().includes(search.toLowerCase()));
  const training = trainings.data?.find((t) => t.id === selected);

  return <div className="space-y-4">
    <PageHeader kicker="Spa" title="Training" description="Kelola training per periode, peserta, persetujuan kelulusan, dan syarat kenaikan level terapis." />
    <Tabs defaultValue="training" className="w-full flex-col">
      <TabsList><TabsTrigger value="training">Training</TabsTrigger><TabsTrigger value="levels">Pengaturan Level</TabsTrigger></TabsList>
      <TabsContent value="training" className="mt-4 space-y-4">
        {training ? <TrainingDetail training={training} canCreate={canCreate} canUpdate={canUpdate} onBack={() => setSelected(null)} onEdit={() => setEditing(training)} /> : <>
          <div className="flex flex-wrap gap-3"><Input className="max-w-md" aria-label="Cari training" placeholder="Cari nama, kode materi, atau periode…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {canCreate && <Button onClick={() => setEditing("new")}>Training baru</Button>}</div>
          <Card className="py-0">
            {trainings.isLoading ? <TableNote>Memuat training…</TableNote> : trainings.error ? <TableNote tone="danger">{trainings.error.message}</TableNote> : !rows.length ? <TableNote>Belum ada training yang sesuai. Buat training pertama untuk mulai mengatur peserta dan syarat level.</TableNote> : <Table>
              <TableHeader><TableRow><TableHead>Training / periode</TableHead><TableHead>Jadwal / trainer</TableHead><TableHead>Peserta / lulus</TableHead><TableHead>Aksi</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((t) => <TableRow key={t.id}>
                <TableCell><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.topic_code} · {t.period}</p></TableCell>
                <TableCell>{formatDate(t.training_date)}<p className="text-xs text-muted-foreground">{t.trainer_name}</p></TableCell>
                <TableCell>{t.participant_count} peserta · {t.passed_count} lulus</TableCell>
                <TableCell><Button variant="outline" size="sm" aria-label={`Kelola peserta ${t.name} ${t.period}`} onClick={() => setSelected(t.id)}>Kelola peserta</Button></TableCell>
              </TableRow>)}</TableBody>
            </Table>}
          </Card>
        </>}
      </TabsContent>
      <TabsContent value="levels" className="mt-4"><LevelSettings trainings={trainings.data ?? []} canUpdate={canUpdate} /></TabsContent>
    </Tabs>
    {editing && <TrainingDialog training={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
  </div>;
}

function TrainingDialog({ training, onClose }: { training: Training | null; onClose: () => void }) {
  const [form, setForm] = useState<TrainingInput>(() => ({ name: training?.name ?? "", topic_code: training?.topic_code ?? "", period: training?.period ?? "", training_date: training?.training_date ?? todayWib(), trainer_name: training?.trainer_name ?? "", notes: training?.notes ?? "" }));
  const save = useSaveTraining();
  const set = (key: keyof TrainingInput, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}><DialogPanel size="md"><DialogPanelForm onSubmit={(e) => {
    e.preventDefault(); save.mutate({ id: training?.id, input: form }, { onSuccess: () => { toast.success("Training disimpan"); onClose(); } });
  }}><DialogPanelHeader><DialogPanelTitle>{training ? "Ubah training" : "Training baru"}</DialogPanelTitle>
    <DialogPanelDescription>Gunakan kode materi yang sama untuk materi serupa dan periode berbeda untuk training baru. Penilaian trainer dilakukan di luar aplikasi.</DialogPanelDescription></DialogPanelHeader>
    <DialogPanelBody className="space-y-3">
      <Field label="Nama training"><Input aria-label="Nama training" required maxLength={150} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode materi"><Input aria-label="Kode materi" required maxLength={80} placeholder="Contoh: PIJAT-DASAR" value={form.topic_code} onChange={(e) => set("topic_code", e.target.value)} /></Field>
        <Field label="Periode"><Input aria-label="Periode" required maxLength={80} placeholder="Contoh: 2026 Gelombang 1" value={form.period} onChange={(e) => set("period", e.target.value)} /></Field>
      </div>
      <Field label="Tanggal training"><Input aria-label="Tanggal training" type="date" required value={form.training_date} onChange={(e) => set("training_date", e.target.value)} /></Field>
      <Field label="Trainer"><Input aria-label="Trainer" required maxLength={150} value={form.trainer_name} onChange={(e) => set("trainer_name", e.target.value)} /></Field>
      <Field label="Catatan"><textarea className={TEXTAREA} aria-label="Catatan" maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <FormError>{save.error?.message}</FormError>
    </DialogPanelBody><DialogFooter><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Batal</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "Menyimpan…" : "Simpan training"}</Button></DialogFooter>
  </DialogPanelForm></DialogPanel></Dialog>;
}
