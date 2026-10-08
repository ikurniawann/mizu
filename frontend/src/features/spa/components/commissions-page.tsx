"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Pencil, Plus, Receipt, Trash2, Users, Wallet } from "lucide-react";
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
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { commissionReportCsv, downloadCsv } from "../csv";
import { useDeleteCommissionRule, useSaveCommissionRule } from "../mutations";
import { useCommissionReport, useCommissionRules, useSpaOutlets, useSpaTreatments } from "../queries";
import {
  COMMISSION_RESOLUTION_TEXT,
  commissionValueLabel,
  computeCommission,
  RULE_SCOPE_LABEL,
  ruleScope,
  ruleSpecificity,
  type RuleScope,
} from "../rules";
import { currentMonthWib, monthRange } from "../time";
import type { CommissionRule, CommissionType, Outlet, Treatment } from "../types";
import { Field, FormError, OutletSelect, SELECT, SPA_KICKER, SpaHint, TableNote } from "./shared";

/** Spa → Komisi Terapis: laporan komisi (hanya booking lunas) dan aturan komisi. */
export function SpaCommissionsPage() {
  const outlets = useSpaOutlets();
  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Komisi Terapis"
        description="Komisi dibekukan saat item treatment selesai, dan baru diakui di laporan bila booking-nya sudah lunas."
      />
      <Tabs defaultValue="report" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="report">Laporan</TabsTrigger>
          <TabsTrigger value="rules">Aturan Komisi</TabsTrigger>
        </TabsList>
        <TabsContent value="report" className="mt-4">
          <ReportTab outlets={outlets.data ?? []} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab outlets={outlets.data ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Laporan ──────────────────────────────────────────────────────────────────

function ReportTab({ outlets }: { outlets: Outlet[] }) {
  const [initial] = useState(() => monthRange(currentMonthWib()));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [branchId, setBranchId] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const invalid = !from || !to || from > to;
  const report = useCommissionReport({ from: invalid ? "" : from, to: invalid ? "" : to, branch_id: branchId || undefined });
  const rows = report.data?.therapists ?? [];
  const treatments = rows.reduce((sum, t) => sum + t.treatment_count, 0);
  const revenue = rows.reduce((sum, t) => sum + t.revenue_idr, 0);
  const outletName = outlets.find((o) => o.branch_id === branchId)?.branch_name;

  const exportCsv = () => {
    if (!report.data) return;
    const suffix = outletName ? `-${outletName.replace(/[^\w-]+/g, "_")}` : "";
    downloadCsv(`komisi-terapis-${from}_${to}${suffix}.csv`, commissionReportCsv(report.data));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_10rem_minmax(0,16rem)_1fr] sm:items-center">
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
        <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} allLabel="Semua outlet" />
        <div className="flex sm:justify-end">
          <Button variant="outline" onClick={exportCsv} disabled={!report.data || rows.length === 0}>
            <Download /> Ekspor CSV
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Item selesai {formatDate(from)} – {formatDate(to)} (WIB) · {outletName ?? "semua outlet"} · hanya booking lunas
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Total komisi" value={formatRupiah(report.data?.total_idr ?? 0)} icon={<Wallet />} tone="ink" />
        <StatCard label="Treatment selesai & lunas" value={formatNumber(treatments)} icon={<Receipt />} />
        <StatCard label="Omzet treatment" value={formatRupiah(revenue)} hint={`${formatNumber(rows.length)} terapis`} icon={<Users />} />
      </div>

      <Card className="py-0">
        {invalid ? (
          <TableNote tone="danger">Periode tidak valid — tanggal awal harus sebelum tanggal akhir.</TableNote>
        ) : report.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={5} rows={5} />
          </div>
        ) : report.error ? (
          <TableNote tone="danger">{report.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada komisi pada periode ini.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terapis</TableHead>
                <TableHead className="text-right">Treatment</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Omzet</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const expanded = !!open[t.therapist_id];
                return (
                  <Fragment key={t.therapist_id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setOpen((o) => ({ ...o, [t.therapist_id]: !expanded }))}
                      aria-expanded={expanded}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          <span>
                            <span className="font-medium">{t.full_name}</span>
                            <span className="block text-xs text-muted-foreground">{t.nip ?? "-"}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(t.treatment_count)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatRupiah(t.revenue_idr)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(t.commission_idr)}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="bg-surface-2 hover:bg-surface-2">
                        <TableCell colSpan={4} className="p-0">
                          <div className="overflow-x-auto px-4 py-3">
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1 pr-3 font-medium">Selesai</th>
                                  <th className="py-1 pr-3 font-medium">Booking</th>
                                  <th className="py-1 pr-3 font-medium">Outlet</th>
                                  <th className="py-1 pr-3 font-medium">Treatment</th>
                                  <th className="py-1 pr-3 text-right font-medium">Harga</th>
                                  <th className="py-1 pr-3 text-right font-medium">Aturan</th>
                                  <th className="py-1 text-right font-medium">Komisi</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.lines.map((l) => (
                                  <tr key={l.item_id} className="border-t border-border">
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(l.completed_at)}</td>
                                    <td className="py-1.5 pr-3 font-mono">{l.booking_code}</td>
                                    <td className="py-1.5 pr-3">{l.branch_name}</td>
                                    <td className="py-1.5 pr-3">
                                      {l.treatment_name} — {l.variant_name}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatRupiah(l.price_idr)}</td>
                                    <td className="py-1.5 pr-3 text-right">{commissionValueLabel(l.commission_type, l.commission_value)}</td>
                                    <td className="py-1.5 text-right font-medium tabular-nums">{formatRupiah(l.commission_idr)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ── Aturan ───────────────────────────────────────────────────────────────────

function RulesTab({ outlets }: { outlets: Outlet[] }) {
  const rules = useCommissionRules();
  const treatments = useSpaTreatments();
  const remove = useDeleteCommissionRule();
  const [editing, setEditing] = useState<CommissionRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<CommissionRule | null>(null);
  const rows = useMemo(
    () =>
      [...(rules.data ?? [])].sort(
        (a, b) =>
          ruleSpecificity(a) - ruleSpecificity(b) ||
          (a.treatment_name ?? "").localeCompare(b.treatment_name ?? "") ||
          (a.variant_name ?? "").localeCompare(b.variant_name ?? "") ||
          (a.branch_name ?? "").localeCompare(b.branch_name ?? "")
      ),
    [rules.data]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Urutan resolusi: paling spesifik menang
          <SpaHint text={COMMISSION_RESOLUTION_TEXT} />
        </p>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <Plus /> Aturan baru
        </Button>
      </div>
      <Card className="py-0">
        {rules.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={5} rows={4} />
          </div>
        ) : rules.error ? (
          <TableNote tone="danger">{rules.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada aturan komisi. Tanpa aturan, komisi item = Rp0.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cakupan</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const scope = ruleScope(r);
                return (
                  <TableRow key={r.id} className={r.is_active ? undefined : "opacity-60"}>
                    <TableCell className="whitespace-normal">
                      <Badge variant={scope === "variant" ? "accent" : scope === "treatment" ? "info" : "secondary"}>
                        {RULE_SCOPE_LABEL[scope]}
                      </Badge>
                      {scope !== "default" && (
                        <p className="mt-1 text-sm font-medium">
                          {r.treatment_name}
                          {scope === "variant" ? ` — ${r.variant_name}` : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{r.branch_name ?? <span className="text-muted-foreground">Semua outlet</span>}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {commissionValueLabel(r.commission_type, r.value)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {r.commission_type === "percent" ? "persentase" : "nominal tetap"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.is_active ? "success" : "muted"}>{r.is_active ? "Aktif" : "Nonaktif"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                          <Pencil /> Ubah
                        </Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(r)}>
                          <Trash2 /> Hapus
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && (
        <RuleDialog
          rule={editing === "new" ? null : editing}
          treatments={treatments.data ?? []}
          outlets={outlets}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus aturan komisi?"
        description="Komisi item yang sudah selesai tidak berubah; item berikutnya memakai aturan lain yang berlaku."
        confirmLabel="Hapus"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Aturan komisi dihapus");
              setDeleting(null);
            },
            onError: (err) => toast.error("Aturan gagal dihapus", { description: err.message }),
          })
        }
      />
    </div>
  );
}

function RuleDialog({
  rule,
  treatments,
  outlets,
  onClose,
}: {
  rule: CommissionRule | null;
  treatments: Treatment[];
  outlets: Outlet[];
  onClose: () => void;
}) {
  const [scope, setScope] = useState<RuleScope>(rule ? ruleScope(rule) : "default");
  const [treatmentId, setTreatmentId] = useState(rule?.treatment_id ?? "");
  const [variantId, setVariantId] = useState(rule?.variant_id ?? "");
  const [branchId, setBranchId] = useState(rule?.branch_id ?? "");
  const [type, setType] = useState<CommissionType>(rule?.commission_type ?? "percent");
  const [value, setValue] = useState(rule ? String(rule.value) : "");
  const [active, setActive] = useState(rule?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveCommissionRule();

  const treatment = treatments.find((t) => t.id === treatmentId);
  const variant = treatment?.variants.find((v) => v.id === variantId);
  const numeric = Number(value);
  const examplePrice = variant?.price_idr ?? treatment?.variants[0]?.price_idr ?? 200000;

  const submit = () => {
    if (scope !== "default" && !treatmentId) return setError("Pilih treatment.");
    if (scope === "variant" && !variantId) return setError("Pilih varian.");
    if (value.trim() === "" || !Number.isFinite(numeric) || numeric < 0) return setError("Nilai komisi harus angka ≥ 0.");
    if (type === "percent" && numeric > 100) return setError("Persentase maksimal 100.");
    setError(null);
    save.mutate(
      {
        id: rule?.id,
        input: {
          treatment_id: scope === "default" ? null : treatmentId,
          variant_id: scope === "variant" ? variantId : null,
          branch_id: branchId || null,
          commission_type: type,
          value: numeric,
          is_active: active,
        },
      },
      {
        onSuccess: () => {
          toast.success(rule ? "Aturan komisi diperbarui" : "Aturan komisi dibuat");
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Aturan gagal disimpan", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{rule ? "Ubah aturan komisi" : "Aturan komisi baru"}</DialogPanelTitle>
            <DialogPanelDescription>{COMMISSION_RESOLUTION_TEXT}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cakupan">
              <select
                className={SELECT}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as RuleScope);
                  if (e.target.value !== "variant") setVariantId("");
                }}
              >
                {(Object.keys(RULE_SCOPE_LABEL) as RuleScope[]).map((s) => (
                  <option key={s} value={s}>
                    {RULE_SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Outlet">
              <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} allLabel="Semua outlet" />
            </Field>
            {scope !== "default" && (
              <Field label="Treatment" className={scope === "treatment" ? "sm:col-span-2" : undefined}>
                <select
                  className={SELECT}
                  value={treatmentId}
                  onChange={(e) => {
                    setTreatmentId(e.target.value);
                    setVariantId("");
                  }}
                  required
                >
                  <option value="">Pilih treatment…</option>
                  {treatments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_active ? "" : " (nonaktif)"}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {scope === "variant" && (
              <Field label="Varian">
                <select className={SELECT} value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={!treatment} required>
                  <option value="">Pilih varian…</option>
                  {(treatment?.variants ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {formatRupiah(v.price_idr)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Tipe">
              <select className={SELECT} value={type} onChange={(e) => setType(e.target.value as CommissionType)}>
                <option value="percent">Persentase (%)</option>
                <option value="fixed">Nominal tetap (Rp)</option>
              </select>
            </Field>
            <Field label={type === "percent" ? "Nilai (%)" : "Nilai (Rp)"}>
              <Input
                type="number"
                min={0}
                max={type === "percent" ? 100 : undefined}
                step={type === "percent" ? "0.01" : "1"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </Field>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={active} onCheckedChange={setActive} aria-label="Aturan aktif" />
              Aktif
            </label>
            {value.trim() !== "" && Number.isFinite(numeric) && numeric >= 0 && (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xs text-muted-foreground sm:col-span-2">
                Contoh: harga {formatRupiah(examplePrice)} → komisi{" "}
                <span className="font-semibold text-foreground">{formatRupiah(computeCommission(type, numeric, examplePrice))}</span>
              </p>
            )}
            <div className="sm:col-span-2">
              <FormError>{error}</FormError>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
