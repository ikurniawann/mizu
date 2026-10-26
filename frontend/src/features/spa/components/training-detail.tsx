"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelForm, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { trainingStatusLabel, useEnrollTraining, useReviewTraining, useTrainingCandidates, useTrainingParticipants, type Training, type TrainingParticipant, type TrainingStatus } from "../training";
import { Field, FormError, SELECT, TableNote, TEXTAREA } from "./shared";

export function TrainingDetail({ training, canCreate, canUpdate, onBack, onEdit }: { training: Training; canCreate: boolean; canUpdate: boolean; onBack: () => void; onEdit: () => void }) {
  const participants = useTrainingParticipants(training.id);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<TrainingParticipant | null>(null);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={onBack}>Kembali ke daftar</Button>
      {canUpdate && <Button variant="outline" onClick={onEdit}>Ubah training</Button>}
      {canCreate && <Button className="ml-auto" onClick={() => setAdding(true)}>Tambah peserta</Button>}</div>
    <Card className="gap-2 p-4"><h2 className="text-lg font-semibold">{training.name} — {training.period}</h2>
      <p className="text-sm text-muted-foreground">{training.topic_code} · {formatDate(training.training_date)} · Trainer: {training.trainer_name}</p>
      {training.notes && <p className="whitespace-pre-wrap text-sm">{training.notes}</p>}
      <p className="text-sm text-muted-foreground">Admin menetapkan kelulusan berdasarkan hasil penilaian trainer di luar aplikasi. Training yang sudah lulus tidak dapat diulang.</p>
    </Card>
    <Card className="py-0">{participants.isLoading ? <TableNote>Memuat peserta…</TableNote> : participants.error ? <TableNote tone="danger">{participants.error.message}</TableNote> : !participants.data?.length ? <TableNote>Belum ada peserta. Pilih Tambah peserta untuk mendaftarkan terapis.</TableNote> : <Table>
      <TableHeader><TableRow><TableHead>Peserta</TableHead><TableHead>Status</TableHead><TableHead>Catatan / persetujuan</TableHead><TableHead>Aksi</TableHead></TableRow></TableHeader>
      <TableBody>{participants.data.map((p) => <TableRow key={p.id}>
        <TableCell><p className="font-medium">{p.therapist_name}</p><p className="text-xs text-muted-foreground">Periode kerja {p.employment_cycle}</p></TableCell>
        <TableCell><Badge variant={p.status === "passed" ? "success" : "muted"}>{trainingStatusLabel[p.status]}</Badge></TableCell>
        <TableCell><p className="whitespace-pre-wrap text-sm">{p.notes || "—"}</p>{p.reviewed_at && <p className="text-xs text-muted-foreground">{p.reviewed_by ?? "Admin"} · {formatDate(p.reviewed_at)}</p>}</TableCell>
        <TableCell>{canUpdate && ["enrolled", "pending"].includes(p.status) && <Button size="sm" variant="outline" onClick={() => setReviewing(p)}>Proses hasil {p.therapist_name}</Button>}</TableCell>
      </TableRow>)}</TableBody>
    </Table>}</Card>
    {adding && <CandidateDialog training={training} onClose={() => setAdding(false)} />}
    {reviewing && <ReviewDialog participant={reviewing} onClose={() => setReviewing(null)} />}
  </div>;
}

function CandidateDialog({ training, onClose }: { training: Training; onClose: () => void }) {
  const candidates = useTrainingCandidates(training.id);
  const enroll = useEnrollTraining(training.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState("");
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const all = candidates.data ?? [];
  const branches = Array.from(new Map(all.map((c) => [c.branch_id, c.branch_name])).entries());
  const rows = all.filter((c) => (showAll || c.can_enroll) && (level === "" || c.level === Number(level)) && (!branch || c.branch_id === branch) && c.full_name.toLowerCase().includes(search.toLowerCase()));
  const chosen = selected.filter((id) => all.some((c) => c.therapist_id === id && c.can_enroll));
  const visibleIds = rows.filter((c) => c.can_enroll).map((c) => c.therapist_id);
  return <Dialog open onOpenChange={(open) => !open && !enroll.isPending && onClose()}><DialogPanel size="xl">
    <DialogPanelHeader><DialogPanelTitle>Tambah peserta — {training.name}</DialogPanelTitle><DialogPanelDescription>Periode {training.period}. Peserta yang sudah lulus atau masih terdaftar tidak dapat dipilih. Kelulusan materi serupa pada periode lain tetap dapat dilihat.</DialogPanelDescription></DialogPanelHeader>
    <DialogPanelBody className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="sm:max-w-56" aria-label="Cari calon peserta" placeholder="Cari terapis…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter level peserta" className={SELECT} value={level} onChange={(e) => setLevel(e.target.value)}><option value="">Semua level</option>{[0, 1, 2].map((n) => <option key={n} value={n}>Level {n}</option>)}</select>
        <select aria-label="Filter outlet peserta" className={SELECT} value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">Semua outlet</option>{branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Tampilkan semua terapis</label>
      <div className="flex flex-wrap items-center gap-3 text-sm"><Button type="button" size="sm" variant="outline" disabled={!visibleIds.length} onClick={() => setSelected((old) => [...new Set([...old, ...visibleIds])])}>Pilih semua yang memenuhi filter</Button>
        <Button type="button" size="sm" variant="ghost" disabled={!chosen.length} onClick={() => setSelected([])}>Hapus pilihan</Button><span>{chosen.length} peserta dipilih, termasuk pilihan di luar filter</span></div>
      {candidates.isLoading ? <TableNote>Memuat calon peserta…</TableNote> : candidates.error ? <FormError>{candidates.error.message}</FormError> : !rows.length ? <TableNote>Tidak ada calon peserta yang sesuai filter.</TableNote> : <div className="max-h-96 overflow-auto"><Table>
        <TableHeader><TableRow><TableHead>Pilih</TableHead><TableHead>Terapis / level</TableHead><TableHead>Status training</TableHead><TableHead>Progres / riwayat materi</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((c) => <TableRow key={c.therapist_id}>
          <TableCell><input type="checkbox" className="size-4" aria-label={`Pilih ${c.full_name}`} disabled={!c.can_enroll || enroll.isPending} checked={chosen.includes(c.therapist_id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, c.therapist_id] : old.filter((id) => id !== c.therapist_id))} /></TableCell>
          <TableCell><p className="font-medium">{c.full_name}</p><p className="text-xs text-muted-foreground">{c.branch_name} · Level {c.level}</p></TableCell>
          <TableCell>{c.reason || "Belum lulus"}{c.reviewed_at && <p className="text-xs text-muted-foreground">{formatDate(c.reviewed_at)}</p>}</TableCell>
          <TableCell className="max-w-xs whitespace-normal text-xs">{c.missing_trainings.length > 0 && <p>Syarat belum terpenuhi: {c.missing_trainings.join(", ")}</p>}
            {c.similar_passes.map((p, i) => <p key={i} className="mt-1 text-muted-foreground">Pernah lulus materi serupa: {p.name} — {p.period}</p>)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
      <FormError>{enroll.error?.message}</FormError>
    </DialogPanelBody><DialogFooter><Button variant="outline" disabled={enroll.isPending} onClick={onClose}>Batal</Button>
      <Button disabled={!chosen.length || chosen.length > 200 || enroll.isPending} onClick={() => enroll.mutate(chosen, { onSuccess: () => { toast.success("Peserta didaftarkan"); onClose(); } })}>{enroll.isPending ? "Mendaftarkan…" : `Daftarkan ${chosen.length} peserta`}</Button></DialogFooter>
  </DialogPanel></Dialog>;
}

function ReviewDialog({ participant, onClose }: { participant: TrainingParticipant; onClose: () => void }) {
  const [status, setStatus] = useState<Exclude<TrainingStatus, "enrolled">>(participant.status === "pending" ? "passed" : "pending");
  const [notes, setNotes] = useState("");
  const review = useReviewTraining();
  const final = status === "passed" || status === "failed";
  return <Dialog open onOpenChange={(open) => !open && !review.isPending && onClose()}><DialogPanel size="sm"><DialogPanelForm onSubmit={(e) => {
    e.preventDefault(); review.mutate({ id: participant.id, status, notes }, { onSuccess: () => { toast.success("Hasil disimpan; syarat level diperiksa otomatis"); onClose(); } });
  }}><DialogPanelHeader><DialogPanelTitle>Hasil training — {participant.therapist_name}</DialogPanelTitle><DialogPanelDescription>Pastikan hasil penilaian trainer di luar aplikasi sudah diperiksa. Kelulusan yang disetujui bersifat final.</DialogPanelDescription></DialogPanelHeader>
    <DialogPanelBody className="space-y-3"><Field label="Keputusan admin"><select className={SELECT} aria-label="Keputusan admin" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
      <option value="pending">Selesai — menunggu persetujuan</option><option value="passed">Setujui kelulusan</option><option value="failed">Tidak lulus</option><option value="cancelled">Batalkan keikutsertaan</option>
    </select></Field><Field label="Catatan hasil trainer"><textarea className={TEXTAREA} aria-label="Catatan hasil trainer" required={final} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ringkasan atau referensi hasil penilaian trainer" /></Field><FormError>{review.error?.message}</FormError></DialogPanelBody>
    <DialogFooter><Button type="button" variant="outline" disabled={review.isPending} onClick={onClose}>Batal</Button><Button type="submit" disabled={review.isPending || (final && !notes.trim())}>{review.isPending ? "Menyimpan…" : "Simpan keputusan"}</Button></DialogFooter>
  </DialogPanelForm></DialogPanel></Dialog>;
}
