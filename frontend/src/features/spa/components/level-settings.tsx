"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLevelRequirements, useSaveLevelRequirements, type LevelRequirements, type Training } from "../training";
import { FormError, TableNote } from "./shared";

export function LevelSettings({ trainings, canUpdate }: { trainings: Training[]; canUpdate: boolean }) {
  const rules = useLevelRequirements();
  if (rules.isLoading) return <TableNote>Memuat syarat level…</TableNote>;
  if (rules.error) return <FormError>{rules.error.message}</FormError>;
  if (!rules.data) return null;
  return <LevelForm key={JSON.stringify(rules.data)} initial={rules.data} trainings={trainings} canUpdate={canUpdate} />;
}

function LevelForm({ initial, trainings, canUpdate }: { initial: LevelRequirements; trainings: Training[]; canUpdate: boolean }) {
  const [form, setForm] = useState(initial);
  const save = useSaveLevelRequirements();
  return <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(form, { onSuccess: () => toast.success("Syarat disimpan dan level terapis diperiksa ulang") }); }}>
    <p className="text-sm text-muted-foreground">Semua training yang dipilih wajib lulus dan disetujui admin dalam periode kerja saat ini. Syarat kosong tidak menaikkan level. Menyimpan perubahan akan mengevaluasi seluruh terapis aktif tanpa menurunkan level yang sudah diperoleh.</p>
    <div className="grid gap-4 lg:grid-cols-2">{(["level_1", "level_2"] as const).map((key, i) => <Card key={key} className="p-4">
      <fieldset disabled={!canUpdate || save.isPending} className="space-y-3"><legend className="mb-3 font-semibold">Level {i} → Level {i + 1}</legend>
        {!trainings.length && <p className="text-sm text-muted-foreground">Buat training terlebih dahulu pada tab Training.</p>}
        {trainings.map((t) => <label key={t.id} className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={form[key].includes(t.id)} onChange={(e) => setForm((old) => ({ ...old, [key]: e.target.checked ? [...old[key], t.id] : old[key].filter((id) => id !== t.id) }))} />
          <span>{t.name} — {t.period}<span className="block text-xs text-muted-foreground">{t.topic_code} · {t.trainer_name}</span></span>
        </label>)}
        <p className="text-xs text-muted-foreground">{form[key].length} training wajib</p>
      </fieldset>
    </Card>)}</div>
    <FormError>{save.error?.message}</FormError>
    {canUpdate && <Button type="submit" disabled={save.isPending}>{save.isPending ? "Menyimpan…" : "Simpan syarat level"}</Button>}
  </form>;
}
