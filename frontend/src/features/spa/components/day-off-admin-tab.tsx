"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCancelDayOff, useSaveDayOffQuota } from "../mutations";
import { useOutletDayOffs } from "../queries";
import { genderLabel } from "../rules";
import { currentMonthWib } from "../time";
import type { DayOffMonth, Outlet } from "../types";
import { Field, FormError, OutletSelect, SELECT, TableNote } from "./shared";

const WEEKDAY = ["", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/**
 * Spa → Terapis → Jadwal Libur (revisi R5): HRD mengatur kuota minimal terapis
 * wanita & pria yang masuk per hari dan batas libur per minggu, lalu memantau
 * libur yang diajukan terapis (bisa dibatalkan bila mendesak).
 */
export function DayOffAdminTab({ outlets }: { outlets: Outlet[] }) {
  const configured = outlets.filter((outlet) => outlet.configured && outlet.is_active);
  const [selectedBranchId, setBranchId] = useState("");
  const [month, setMonth] = useState(() => currentMonthWib());
  const branchId = selectedBranchId || configured[0]?.branch_id || "";
  const data = useOutletDayOffs(branchId, month);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <OutletSelect outlets={configured} value={branchId} onChange={setBranchId} className={SELECT} />
        </div>
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Bulan" />
      </div>
      {!branchId ? (
        <Card className="py-0">
          <TableNote>Belum ada outlet spa.</TableNote>
        </Card>
      ) : data.isLoading ? (
        <SkeletonTable columns={4} rows={6} />
      ) : data.error ? (
        <Card className="py-0">
          <TableNote tone="danger">{data.error.message}</TableNote>
        </Card>
      ) : data.data ? (
        <>
          <QuotaForm key={`${branchId}-${data.data.quota.min_female}-${data.data.quota.min_male}-${data.data.quota.max_per_week}`} data={data.data} />
          <MonthTable data={data.data} />
        </>
      ) : null}
    </div>
  );
}

function QuotaForm({ data }: { data: DayOffMonth }) {
  const [female, setFemale] = useState(String(data.quota.min_female));
  const [male, setMale] = useState(String(data.quota.min_male));
  const [perWeek, setPerWeek] = useState(String(data.quota.max_per_week));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveDayOffQuota();
  const submit = () => {
    const f = Number(female), m = Number(male), w = Number(perWeek);
    if (![f, m].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) return setError("Kuota minimal 0–100 orang.");
    if (!Number.isInteger(w) || w < 0 || w > 7) return setError("Libur per minggu 0–7 hari.");
    setError(null);
    save.mutate(
      { branchId: data.branch_id, input: { min_female: f, min_male: m, max_per_week: w } },
      {
        onSuccess: () => toast.success("Kuota libur disimpan"),
        onError: (err) => {
          setError(err.message);
          toast.error("Kuota gagal disimpan", { description: err.message });
        },
      },
    );
  };
  return (
    <Card className="gap-3 px-5">
      <div>
        <p className="font-semibold">Kuota hari libur</p>
        <p className="text-xs text-muted-foreground">
          Pengajuan libur ditolak otomatis bila membuat terapis wanita atau pria yang masuk di bawah minimal. Libur tetap dari jadwal shift HRIS ikut dihitung dalam batas per minggu.
        </p>
      </div>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Min. terapis wanita masuk / hari">
          <Input type="number" min={0} max={100} value={female} onChange={(e) => setFemale(e.target.value)} aria-label="Minimal terapis wanita" />
        </Field>
        <Field label="Min. terapis pria masuk / hari">
          <Input type="number" min={0} max={100} value={male} onChange={(e) => setMale(e.target.value)} aria-label="Minimal terapis pria" />
        </Field>
        <Field label="Maks. libur / minggu">
          <Input type="number" min={0} max={7} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} aria-label="Maksimal libur per minggu" />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : "Simpan kuota"}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </Card>
  );
}

function MonthTable({ data }: { data: DayOffMonth }) {
  const cancel = useCancelDayOff();
  const byDate = new Map<string, DayOffMonth["requests"]>();
  for (const r of data.requests) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const q = data.quota;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal</TableHead>
            <TableHead>Masuk</TableHead>
            <TableHead>Libur diajukan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.days.map((d) => {
            const reqs = byDate.get(d.date) ?? [];
            const shortF = d.working_female < q.min_female;
            const shortM = d.working_male < q.min_male;
            return (
              <TableRow key={d.date} className={cn((d.weekday === 6 || d.weekday === 7) && "bg-surface/50")}>
                <TableCell className="whitespace-nowrap">
                  <span className="mr-2 text-xs text-muted-foreground">{WEEKDAY[d.weekday]}</span>
                  {formatDate(d.date)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <span className={cn(shortF && "font-semibold text-danger")}>{d.working_female} wanita</span>
                  {" · "}
                  <span className={cn(shortM && "font-semibold text-danger")}>{d.working_male} pria</span>
                  {(shortF || shortM) && <Badge variant="destructive" className="ml-2">Di bawah kuota</Badge>}
                </TableCell>
                <TableCell>
                  {reqs.length === 0 ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {reqs.map((r) => (
                        <li key={r.id} className={cn("flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs", r.status === "cancelled" && "line-through opacity-60")}>
                          {r.therapist_name}
                          {r.gender ? <span className="text-muted-foreground">({genderLabel(r.gender)})</span> : null}
                          {r.status === "approved" && (
                            <button
                              type="button"
                              className="ml-1 text-danger hover:underline"
                              disabled={cancel.isPending}
                              title="Batalkan libur ini"
                              onClick={() =>
                                cancel.mutate(
                                  { id: r.id, reason: "Dibatalkan HRD" },
                                  {
                                    onSuccess: () => toast.success("Libur dibatalkan", { description: `${r.therapist_name} · ${formatDateLong(r.date)}` }),
                                    onError: (err) => toast.error("Gagal membatalkan", { description: err.message }),
                                  },
                                )
                              }
                            >
                              batalkan
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
