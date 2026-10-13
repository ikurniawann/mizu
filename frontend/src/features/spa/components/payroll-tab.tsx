"use client";

import { useState } from "react";
import { Banknote, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatRupiah } from "@/lib/format";
import { useCreatePayRun, useDeletePayRun, usePayRunAction, useRecalcPayRun, useSavePaySettings, useSetPayType, useUpdatePayLine } from "../mutations";
import { usePayRun, usePayRuns, usePaySettings, useTherapistPays } from "../queries";
import { PAY_KIND_LABEL, PAY_STATUS_LABEL, PAY_STATUS_VARIANT, PAY_TYPE_LABEL } from "../payroll";
import { currentMonthWib } from "../time";
import type { PayLine, PayRun, PaySettings, PayType } from "../types";
import { Field, FormError, SELECT, TableNote } from "./shared";

/**
 * Spa → Komisi → Payroll Terapis (revisi R1): dua tipe terapis (gaji tetap +
 * komisi / komisi saja) dan dua kali gajian sebulan — komisi tengah bulan
 * (tgl 1 s.d. tanggal komisi) dan gaji reguler akhir bulan (gaji tetap + komisi sisa bulan).
 */
export function PayrollTab() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <SettingsCard />
      <RunsCard onOpen={setOpen} />
      <PayTypesCard />
      {open && <RunDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SettingsCard() {
  const cfg = usePaySettings();
  if (cfg.isLoading) return <SkeletonTable columns={3} rows={1} />;
  if (cfg.error) return <Card className="py-0"><TableNote tone="danger">{cfg.error.message}</TableNote></Card>;
  return cfg.data ? <SettingsForm key={`${cfg.data.commission_day}-${cfg.data.salary_day}`} cfg={cfg.data} /> : null;
}

function SettingsForm({ cfg }: { cfg: PaySettings }) {
  const [commission, setCommission] = useState(String(cfg.commission_day));
  const [salary, setSalary] = useState(String(cfg.salary_day));
  const [error, setError] = useState<string | null>(null);
  const save = useSavePaySettings();
  const submit = () => {
    const c = Number(commission), s = Number(salary);
    if (!Number.isInteger(c) || c < 1 || c > 28) return setError("Tanggal komisi 1–28.");
    if (!Number.isInteger(s) || s < 1 || s > 31) return setError("Tanggal gajian 1–31.");
    if (s <= c) return setError("Tanggal gajian harus setelah tanggal komisi.");
    setError(null);
    save.mutate({ commission_day: c, salary_day: s }, {
      onSuccess: () => toast.success("Tanggal gajian disimpan"),
      onError: (err) => { setError(err.message); toast.error("Gagal menyimpan", { description: err.message }); },
    });
  };
  return (
    <Card className="gap-3 px-5">
      <div>
        <p className="font-semibold">Jadwal gajian terapis</p>
        <p className="text-xs text-muted-foreground">
          Komisi tengah bulan membayar komisi treatment yang selesai & lunas pada tanggal 1 s.d. tanggal komisi. Gaji reguler membayar gaji tetap
          (terapis bertipe gaji tetap + komisi, dari data gaji HRIS) ditambah komisi sisa bulan. Tanggal gajian lewat akhir bulan memakai tanggal terakhir.
        </p>
      </div>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Tanggal bayar komisi">
          <Input type="number" min={1} max={28} value={commission} onChange={(e) => setCommission(e.target.value)} aria-label="Tanggal bayar komisi" />
        </Field>
        <Field label="Tanggal gajian reguler">
          <Input type="number" min={1} max={31} value={salary} onChange={(e) => setSalary(e.target.value)} aria-label="Tanggal gajian reguler" />
        </Field>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Menyimpan…" : "Simpan jadwal"}</Button>
      </form>
      <FormError>{error}</FormError>
    </Card>
  );
}

function RunsCard({ onOpen }: { onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => currentMonthWib());
  const [kind, setKind] = useState<PayRun["kind"]>("commission");
  const runs = usePayRuns();
  const create = useCreatePayRun();
  const run = () =>
    create.mutate({ month, kind }, {
      onSuccess: (r) => { toast.success("Payroll dibuat", { description: `${PAY_KIND_LABEL[r.kind]} · ${r.line_count} terapis` }); onOpen(r.id); },
      onError: (err) => toast.error("Payroll gagal dibuat", { description: err.message }),
    });
  const list = runs.data ?? [];
  return (
    <Card className="gap-3 px-5">
      <div className="flex flex-wrap items-end gap-3">
        <p className="mr-auto font-semibold">Payroll terapis</p>
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Bulan payroll" />
        <select className={`${SELECT} w-56`} value={kind} onChange={(e) => setKind(e.target.value as PayRun["kind"])} aria-label="Jenis payroll">
          <option value="commission">{PAY_KIND_LABEL.commission}</option>
          <option value="regular">{PAY_KIND_LABEL.regular}</option>
        </select>
        <Button onClick={run} disabled={create.isPending}><Banknote /> {create.isPending ? "Menghitung…" : "Buat payroll"}</Button>
      </div>
      {runs.isLoading ? (
        <SkeletonTable columns={6} rows={3} />
      ) : runs.error ? (
        <TableNote tone="danger">{runs.error.message}</TableNote>
      ) : list.length === 0 ? (
        <TableNote>Belum ada payroll terapis.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Periode</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Tanggal bayar</TableHead>
              <TableHead>Terapis</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
                <TableCell className="whitespace-nowrap">{formatDate(r.period_start)} – {formatDate(r.period_end)}</TableCell>
                <TableCell>{PAY_KIND_LABEL[r.kind]}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.pay_date)}</TableCell>
                <TableCell className="tabular-nums">{r.line_count}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(r.total_idr)}</TableCell>
                <TableCell><Badge variant={PAY_STATUS_VARIANT[r.status]}>{PAY_STATUS_LABEL[r.status]}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function PayTypesCard() {
  const pays = useTherapistPays();
  const setType = useSetPayType();
  const list = (pays.data ?? []).filter((p) => p.is_active);
  return (
    <Card className="gap-3 px-5">
      <div>
        <p className="font-semibold">Tipe gaji terapis</p>
        <p className="text-xs text-muted-foreground">Gaji pokok & tunjangan tetap diambil dari data gaji karyawan di HRIS. Terapis komisi saja tidak menerima gaji tetap.</p>
      </div>
      {pays.isLoading ? (
        <SkeletonTable columns={4} rows={4} />
      ) : pays.error ? (
        <TableNote tone="danger">{pays.error.message}</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Terapis</TableHead>
              <TableHead>Outlet</TableHead>
              <TableHead className="text-right">Gaji pokok + tunjangan (HRIS)</TableHead>
              <TableHead>Tipe gaji</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.therapist_id}>
                <TableCell className="font-medium">{p.full_name}</TableCell>
                <TableCell>{p.branch_name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.base_salary_idr + p.allowance_idr > 0 ? formatRupiah(p.base_salary_idr + p.allowance_idr) : <span className="text-muted-foreground">Belum diisi</span>}
                </TableCell>
                <TableCell>
                  <select
                    className={`${SELECT} w-52`}
                    value={p.pay_type}
                    aria-label={`Tipe gaji ${p.full_name}`}
                    disabled={setType.isPending}
                    onChange={(e) =>
                      setType.mutate({ therapistId: p.therapist_id, payType: e.target.value as PayType }, {
                        onSuccess: () => toast.success("Tipe gaji diperbarui", { description: p.full_name }),
                        onError: (err) => toast.error("Gagal mengubah tipe gaji", { description: err.message }),
                      })
                    }
                  >
                    <option value="salary_commission">{PAY_TYPE_LABEL.salary_commission}</option>
                    <option value="commission_only">{PAY_TYPE_LABEL.commission_only}</option>
                  </select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function RunDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const run = usePayRun(id);
  const action = usePayRunAction(id);
  const recalc = useRecalcPayRun(id);
  const remove = useDeletePayRun();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const r = run.data;
  const draft = r?.status === "draft";
  const act = (a: "approve" | "pay" | "reopen", msg: string) =>
    action.mutate(a, { onSuccess: () => toast.success(msg), onError: (err) => toast.error("Gagal", { description: err.message }) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="xl">
        <DialogPanelHeader>
          <DialogPanelTitle>{r ? `${PAY_KIND_LABEL[r.kind]} · ${r.period_month}` : "Payroll terapis"}</DialogPanelTitle>
          <DialogPanelDescription>
            {r ? `Periode ${formatDate(r.period_start)} – ${formatDate(r.period_end)}, dibayar ${formatDate(r.pay_date)}. Komisi dihitung dari treatment selesai & lunas yang belum dibayar.` : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          {run.isLoading ? (
            <SkeletonTable columns={6} rows={4} />
          ) : run.error ? (
            <TableNote tone="danger">{run.error.message}</TableNote>
          ) : r ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={PAY_STATUS_VARIANT[r.status]}>{PAY_STATUS_LABEL[r.status]}</Badge>
                <span className="text-sm">Total <span className="font-semibold tabular-nums">{formatRupiah(r.total_idr)}</span> · {r.lines?.length ?? 0} terapis</span>
              </div>
              {(r.lines ?? []).length === 0 ? (
                <TableNote>Tidak ada yang perlu dibayar di periode ini.</TableNote>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Terapis</TableHead>
                      <TableHead className="text-right">Gaji + tunjangan</TableHead>
                      <TableHead className="text-right">Komisi</TableHead>
                      <TableHead className="text-right">Bonus</TableHead>
                      <TableHead className="text-right">Potongan</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(r.lines ?? []).map((l) => (
                      <LineRow key={l.id} line={l} runId={r.id} editable={draft} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          ) : null}
        </DialogPanelBody>
        <DialogFooter className="flex-wrap">
          {draft && (
            <>
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmDelete(true)}><Trash2 /> Hapus draft</Button>
              <Button variant="outline" disabled={recalc.isPending} onClick={() => recalc.mutate(undefined, { onSuccess: () => toast.success("Dihitung ulang"), onError: (err) => toast.error("Gagal", { description: err.message }) })}>
                <RefreshCw /> Hitung ulang
              </Button>
              <Button disabled={action.isPending} onClick={() => act("approve", "Payroll disetujui")}><CheckCircle2 /> Setujui</Button>
            </>
          )}
          {r?.status === "approved" && (
            <>
              <Button variant="outline" disabled={action.isPending} onClick={() => act("reopen", "Payroll dibuka kembali")}>Buka kembali</Button>
              <Button disabled={action.isPending} onClick={() => act("pay", "Payroll ditandai dibayar")}><Banknote /> Tandai dibayar</Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogPanel>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Hapus draft payroll?"
        description="Komisi di dalamnya kembali tersedia untuk payroll berikutnya."
        confirmLabel="Hapus"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(id, { onSuccess: () => { toast.success("Draft dihapus"); onClose(); }, onError: (err) => toast.error("Gagal", { description: err.message }) })}
      />
    </Dialog>
  );
}

function LineRow({ line, runId, editable }: { line: PayLine; runId: string; editable: boolean }) {
  const [bonus, setBonus] = useState(line.bonus_idr);
  const [deduction, setDeduction] = useState(line.deduction_idr);
  const update = useUpdatePayLine(runId);
  const dirty = bonus !== line.bonus_idr || deduction !== line.deduction_idr;
  const save = () =>
    update.mutate({ lineId: line.id, input: { bonus_idr: bonus, deduction_idr: deduction, note: line.note } }, {
      onSuccess: () => toast.success("Baris diperbarui", { description: line.therapist_name }),
      onError: (err) => toast.error("Gagal", { description: err.message }),
    });
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{line.therapist_name}</span>
        <span className="block text-xs text-muted-foreground">{line.branch_name} · {PAY_TYPE_LABEL[line.pay_type]}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatRupiah(line.base_salary_idr + line.allowance_idr)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRupiah(line.commission_idr)}
        <span className="block text-xs text-muted-foreground">{line.commission_count} treatment</span>
      </TableCell>
      <TableCell className="text-right">
        {editable ? <NumericInput prefix="Rp" value={bonus} onValueChange={setBonus} className="w-32" aria-label={`Bonus ${line.therapist_name}`} /> : <span className="tabular-nums">{formatRupiah(line.bonus_idr)}</span>}
      </TableCell>
      <TableCell className="text-right">
        {editable ? <NumericInput prefix="Rp" value={deduction} onValueChange={setDeduction} className="w-32" aria-label={`Potongan ${line.therapist_name}`} /> : <span className="tabular-nums">{formatRupiah(line.deduction_idr)}</span>}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {formatRupiah(line.total_idr)}
        {editable && dirty && (
          <Button size="sm" variant="ghost" className="ml-1" disabled={update.isPending} onClick={save}>Simpan</Button>
        )}
      </TableCell>
    </TableRow>
  );
}
