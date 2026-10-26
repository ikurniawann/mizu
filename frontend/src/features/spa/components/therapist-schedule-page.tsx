"use client";

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { todayWib } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { SHIFT_DAY_NAMES } from "@/lib/hris/employee-profile-shifts";
import { isoDayOfWeek, resolveScheduleRowForDate } from "@/lib/hris/shifts";
import { cn } from "@/lib/utils";
import { fetchEmployeeShiftSchedule, fetchShiftOptions, type EmployeeShiftScheduleRow } from "@/features/users/api";
import { usersQueryKeys } from "@/features/users/query-keys";
import { spaApi } from "../api";
import { spaKeys } from "../query-keys";
import { useSpaOutlets, useSpaTherapists } from "../queries";
import { addDaysToDate } from "../time";
import { OutletSelect, SELECT, SPA_KICKER, TableNote } from "./shared";
import { RosterGeneratorDialog } from "./roster-generator-dialog";
import { TherapistShiftMappingDialog } from "./therapist-shift-mapping-dialog";

function shiftName(row: EmployeeShiftScheduleRow | null) {
  if (!row) return "Belum diatur";
  if (!row.shift_id) return "Libur";
  return row.shift_name || "Shift";
}

/** Jadwal berdasarkan tanggal aktual, termasuk pergantian pola di tengah minggu. */
export function TherapistSchedulePage({ embedded = false }: { embedded?: boolean }) {
  const outlets = useSpaOutlets();
  const configured = (outlets.data ?? []).filter((outlet) => outlet.configured && outlet.is_active);
  const [preferredBranchId, setBranchId] = useState("");
  const [viewDate, setViewDate] = useState(todayWib);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<{ date: string; therapistId?: string } | null>(null);
  const branchId = preferredBranchId || configured[0]?.branch_id || "";
  const therapists = useSpaTherapists({ branch_id: branchId || undefined, active: true });
  const shifts = useQuery({ queryKey: ["spa", "therapist-schedule", "shifts"], queryFn: fetchShiftOptions });
  const rows = branchId ? (therapists.data ?? []) : [];
  const schedules = useQueries({
    queries: rows.map((therapist) => ({
      queryKey: usersQueryKeys.shiftSchedule(therapist.employee_id),
      // Match the shared employee schedule cache: rows, not an API envelope.
      queryFn: async () => (await fetchEmployeeShiftSchedule(therapist.employee_id)).data ?? [],
      enabled: !!therapist.employee_id,
    })),
  });
  const monday = addDaysToDate(viewDate, 1 - isoDayOfWeek(viewDate));
  const dates = SHIFT_DAY_NAMES.map((_, index) => addDaysToDate(monday, index));
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const dayOffQueries = useQueries({
    queries: months.map((month) => ({
      queryKey: spaKeys.outletDayOffs(branchId, month),
      queryFn: () => spaApi.outletDayOffs(branchId, month),
      enabled: !!branchId,
    })),
  });
  const approvedOffs = new Set(dayOffQueries.flatMap((query) => query.data?.requests ?? [])
    .filter((request) => request.status === "approved")
    .map((request) => `${request.therapist_id}:${request.date}`));
  const today = todayWib();
  const entries = rows.map((therapist, index) => {
    const query = schedules[index];
    const history = query.data ?? [];
    const week = dates.map((date) => resolveScheduleRowForDate(history, date));
    return { therapist, history, week, query, workingDays: week.filter((row, day) => row?.shift_id && !approvedOffs.has(`${therapist.id}:${dates[day]}`)).length };
  });
  const ready = !therapists.isPending && entries.every(({ query }) => query.isSuccess);
  const visible = entries.filter(({ therapist, week, workingDays, query }) => {
    const matchesName = `${therapist.full_name} ${therapist.nip ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesName && (status === "all" || (query.isSuccess && (status === "assigned" ? workingDays > 0 : week.some((row) => !row))));
  });
  const unavailable = outlets.isError || therapists.isError;
  const loading = outlets.isPending || (!!branchId && therapists.isPending);

  return (
    <div className="min-w-0 space-y-5">
      {!embedded && <PageHeader kicker={SPA_KICKER} title="Jadwal Shift" description="Lihat dan atur jadwal kerja mingguan terapis." />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Jadwal shift mingguan</h2>
          <p className="mt-1 text-sm text-muted-foreground">Lihat siapa yang bertugas dan jam kerjanya. Klik sel jadwal untuk mengubah satu terapis.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setGenerating(true)} disabled={!branchId || shifts.isPending || shifts.isError}>Generate jadwal bulanan</Button>
        <Button onClick={() => setEditing({ date: viewDate })} disabled={!branchId || !ready || !rows.length || shifts.isPending || shifts.isError}>
          <Plus /> Atur mapping
        </Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Terapis aktif", value: loading || unavailable ? "—" : rows.length, note: "Di outlet yang dipilih", icon: Users },
          { label: "Punya shift minggu ini", value: ready && !unavailable ? entries.filter((entry) => entry.workingDays > 0).length : "—", note: "Minimal satu hari kerja", icon: CalendarDays },
          { label: "Perlu dilengkapi", value: ready && !unavailable ? entries.filter((entry) => entry.week.some((row) => !row)).length : "—", note: "Masih ada hari belum diatur", icon: CalendarDays },
        ].map(({ label, value, note, icon: Icon }) => (
          <Card key={label} className="flex-row items-center justify-between gap-4 p-4">
            <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="my-1 text-2xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{note}</p></div>
            <div className="rounded-xl bg-surface-2 p-3 text-brand-text"><Icon className="size-5" /></div>
          </Card>
        ))}
      </div>

      <Card className="min-w-0 gap-0 overflow-hidden p-0">
        <div className="grid gap-3 border-b p-4 md:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium">Outlet<OutletSelect outlets={configured} value={branchId} onChange={setBranchId} className={SELECT} /></label>
          <label className="space-y-1.5 text-xs font-medium">Cari terapis<div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Nama atau NIP" value={search} onChange={(event) => setSearch(event.target.value)} /></div></label>
          <label className="space-y-1.5 text-xs font-medium">Tampilkan<select className={SELECT} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Semua terapis aktif</option><option value="assigned">Punya shift minggu ini</option><option value="incomplete">Perlu dilengkapi</option></select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">{formatDate(dates[0])} – {formatDate(dates[6])}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Pola kerja terapis aktif · Semua jam dalam WIB</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon-sm" aria-label="Minggu sebelumnya" onClick={() => setViewDate(addDaysToDate(viewDate, -7))}><ChevronLeft /></Button>
            <Button variant="outline" size="sm" onClick={() => setViewDate(today)}>Minggu ini</Button>
            <Button variant="outline" size="icon-sm" aria-label="Minggu berikutnya" onClick={() => setViewDate(addDaysToDate(viewDate, 7))}><ChevronRight /></Button>
            <Input type="date" aria-label="Lihat minggu pada tanggal" className="h-8 w-36 text-xs" value={viewDate} onChange={(event) => { if (event.target.value) setViewDate(event.target.value); }} />
          </div>
        </div>
        {shifts.isError && <p role="alert" className="border-b p-4 text-sm text-danger">Daftar shift gagal dimuat. <button className="underline" onClick={() => void shifts.refetch()}>Coba lagi</button></p>}
        {dayOffQueries.some((query) => query.isError) && <p role="alert" className="border-b p-4 text-sm text-danger">Jadwal libur gagal dimuat. <button className="underline" onClick={() => { dayOffQueries.forEach((query) => { if (query.isError) void query.refetch(); }); }}>Coba lagi</button></p>}
        {unavailable ? <div role="alert" className="p-6 text-sm text-danger">Data outlet atau terapis gagal dimuat. <button className="underline" onClick={() => { void outlets.refetch(); void therapists.refetch(); }}>Coba lagi</button></div>
          : loading ? <TableNote>Memuat terapis…</TableNote>
          : !branchId ? <TableNote>Belum ada outlet Spa aktif yang dikonfigurasi.</TableNote>
          : rows.length === 0 ? <TableNote>Belum ada terapis aktif di outlet ini.</TableNote>
          : visible.length === 0 ? <TableNote>Tidak ada terapis yang sesuai pencarian atau filter.</TableNote>
          : <div role="region" aria-label="Jadwal mingguan terapis" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
              <caption className="sr-only">Jadwal shift terapis {formatDate(dates[0])} sampai {formatDate(dates[6])}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-48 min-w-40 bg-surface-2 px-4 py-3 text-xs font-semibold">Terapis <span className="font-normal text-muted-foreground">({visible.length})</span></th>
                  {dates.map((date, index) => <th key={date} scope="col" className={cn("min-w-32 px-2 py-3 text-xs font-medium", date === today && "bg-success-soft")}>
                    <div className="flex items-center gap-1.5">{SHIFT_DAY_NAMES[index]}{date === today && <span className="size-1.5 rounded-full bg-success" title="Hari ini" />}</div>
                    <p className="mt-1 text-muted-foreground">{formatDate(date)}</p>
                    <p className="mt-2 text-[11px] text-brand-text">{ready && dayOffQueries.every((query) => query.isSuccess) ? `${entries.filter((entry) => entry.week[index]?.shift_id && !approvedOffs.has(`${entry.therapist.id}:${date}`)).length} terapis` : "Memuat…"}</p>
                  </th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(({ therapist, week, query, workingDays }) => <tr key={therapist.id}>
                  <th scope="row" className="sticky left-0 z-10 border-r bg-card px-4 py-4 font-normal">
                    <p className="font-semibold">{therapist.full_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{therapist.nip || "Terapis"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5"><Badge variant="success">Aktif</Badge>{query.isSuccess && <span className="text-[11px] text-muted-foreground">{workingDays} hari kerja</span>}</div>
                  </th>
                  {query.isError ? <td colSpan={7} className="p-4 text-sm text-danger">Jadwal gagal dimuat. <button className="underline" onClick={() => void query.refetch()}>Muat ulang {therapist.full_name}</button></td>
                    : !query.isSuccess ? <td colSpan={7} className="p-4 text-muted-foreground">Memuat jadwal…</td>
                    : week.map((row, index) => {
                      const approvedOff = approvedOffs.has(`${therapist.id}:${dates[index]}`);
                      return <td key={dates[index]} className={cn("p-1.5 align-top", dates[index] === today && "bg-success-soft/30")}>
                      <button
                        className={cn("flex min-h-24 w-full flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition hover:border-brand-text focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60", approvedOff ? "border-warning/30 bg-warning-soft/60" : row?.shift_id ? "border-success/20 bg-success-soft/60" : "border-dashed border-border bg-card")}
                        aria-label={`Atur ${therapist.full_name}, ${SHIFT_DAY_NAMES[index]} ${formatDate(dates[index])}`}
                        disabled={shifts.isPending || shifts.isError}
                        onClick={() => setEditing({ date: dates[index], therapistId: therapist.id })}
                      >
                        <span className={cn("text-xs font-semibold", approvedOff ? "text-warning" : row?.shift_id ? "text-brand-text" : "text-muted-foreground")}>{approvedOff ? "Libur disetujui" : shiftName(row)}</span>
                        {row?.shift_id && !approvedOff && <>
                          <span className="text-xs font-medium tabular-nums">{row.start_time?.slice(0, 5) || "—"}–{row.end_time?.slice(0, 5) || "—"}</span>
                          {row.start_time && row.end_time && row.end_time <= row.start_time && <span className="text-[10px] text-muted-foreground">Selesai hari berikutnya</span>}
                          <span className="mt-auto pt-1 text-[10px] text-muted-foreground">Sejak {formatDate(row.effective_from)}{row.effective_to ? ` s.d. ${formatDate(row.effective_to)}` : ""}</span>
                        </>}
                        {!row && !approvedOff && <span className="text-[10px] text-muted-foreground">+ Atur shift</span>}
                      </button>
                    </td>; })}
                </tr>)}
              </tbody>
            </table>
          </div>}
        <div className="space-y-1 border-t bg-surface-2/50 px-4 py-3 text-xs text-muted-foreground">
          <p>Geser tabel untuk melihat seluruh minggu. Belum diatur = belum ada shift pada tanggal tersebut. Libur disetujui berasal dari pengajuan di tab Jadwal Libur.</p>
        </div>
      </Card>
      {generating && <RosterGeneratorDialog branchId={branchId} outletName={configured.find(o=>o.branch_id===branchId)?.branch_name??""} initialMonth={viewDate.slice(0,7)} shifts={shifts.data?.data??[]} onClose={()=>setGenerating(false)} onSaved={date=>{setViewDate(date);setGenerating(false);}}/>}
      {editing && <TherapistShiftMappingDialog
        initialDate={editing.date}
        singleTherapist={!!editing.therapistId}
        entries={entries.filter((entry) => !editing.therapistId || entry.therapist.id === editing.therapistId)}
        shifts={shifts.data?.data ?? []}
        outletName={configured.find((outlet) => outlet.branch_id === branchId)?.branch_name ?? ""}
        onClose={() => setEditing(null)}
        onSaved={(date) => { setViewDate(date); setStatus("all"); setSearch(""); setEditing(null); }}
      />}
    </div>
  );
}
