"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Bot, Loader2, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayWib } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { useCreateWaitlist, useSetWaitlistStatus } from "../mutations";
import { useSpaOutlets, useSpaWaitlist } from "../queries";
import type { WaitlistEntry, WaitlistStatus } from "../types";
import { OutletSelect, SELECT, TableNote } from "./shared";

/**
 * EPIC-053 Fase 3 — Daftar tunggu: tamu yang ingin dikabari saat jam kosong
 * (dari bot WhatsApp atau dicatat FO). Pengawas bot mengabari otomatis lewat
 * WhatsApp; FO menutup entri yang sudah ditangani lewat telepon/booking.
 */

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  open: "Menunggu",
  notified: "Sudah dikabari",
  booked: "Jadi booking",
  cancelled: "Dibatalkan",
  expired: "Lewat tanggal",
};

const STATUS_STYLE: Record<WaitlistStatus, string> = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  notified: "bg-sky-50 text-sky-700 border-sky-200",
  booked: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 border-slate-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
};

const PERIOD_LABEL: Record<WaitlistEntry["period"], string> = {
  "": "Kapan saja",
  pagi: "Pagi",
  siang: "Siang",
  sore: "Sore",
  malam: "Malam",
};

export function WaitlistStatusBadge({ status }: { status: WaitlistStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SpaWaitlistPage() {
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState<WaitlistStatus | "">("");
  const [showForm, setShowForm] = useState(false);
  const outlets = useSpaOutlets();
  const list = useSpaWaitlist({ branch_id: branchId || undefined, status });
  const setStatusMutation = useSetWaitlistStatus();
  const rows = list.data ?? [];
  const error = list.error instanceof Error ? list.error.message : setStatusMutation.error instanceof Error ? setStatusMutation.error.message : null;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Studio"
        title="Daftar Tunggu"
        description="Tamu yang menunggu jam kosong. Entri dari bot WhatsApp dikabari otomatis begitu ada jam; entri yang Anda catat sendiri ditangani lewat telepon."
        actions={
          <>
            <Link
              href="/dashboard/spa/bookings"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft className="size-4" /> Booking History
            </Link>
            <Button type="button" onClick={() => setShowForm((v) => !v)} className="purchasing-main-button">
              {showForm ? "Tutup form" : "Catat tamu"}
            </Button>
          </>
        }
      />

      {showForm && (
        <WaitlistForm
          outlets={outlets.data ?? []}
          defaultBranch={branchId}
          onDone={() => setShowForm(false)}
        />
      )}

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <OutletSelect outlets={outlets.data ?? []} value={branchId} onChange={setBranchId} allLabel="Semua toko" className={SELECT} />
          <select value={status} onChange={(e) => setStatus(e.target.value as WaitlistStatus | "")} className={SELECT} aria-label="Status">
            <option value="">Menunggu & sudah dikabari</option>
            {(Object.keys(STATUS_LABEL) as WaitlistStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <SkeletonTable rows={5} columns={7} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Toko</TableHead>
                <TableHead>Tamu</TableHead>
                <TableHead>Keinginan</TableHead>
                <TableHead>Sumber</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
                    Tidak ada tamu yang menunggu.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-medium">{formatDate(entry.visit_date)}</div>
                      <div className="text-xs text-slate-500">{PERIOD_LABEL[entry.period]}</div>
                    </TableCell>
                    <TableCell>{entry.branch_name || "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{entry.customer_name || "Tanpa nama"}</div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Phone className="size-3" /> {entry.customer_phone}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{entry.people} orang</div>
                      {entry.variant_labels.length > 0 && (
                        <div className="text-xs text-slate-500">{entry.variant_labels.join(", ")}</div>
                      )}
                      {entry.note && <div className="text-xs text-slate-500">{entry.note}</div>}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                        {entry.source === "whatsapp" ? <Bot className="size-3.5 text-teal-600" /> : <UserRound className="size-3.5" />}
                        {entry.source === "whatsapp" ? "Bot WhatsApp" : entry.source === "front_office" ? "Front office" : "Website"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <WaitlistStatusBadge status={entry.status} />
                      {entry.notified_at && (
                        <div className="mt-0.5 text-[11px] text-slate-400">dikabari {formatDateTime(entry.notified_at)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.status === "open" || entry.status === "notified" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={setStatusMutation.isPending}
                            onClick={() => setStatusMutation.mutate({ id: entry.id, status: "booked" })}
                          >
                            Jadi booking
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={setStatusMutation.isPending}
                            onClick={() => setStatusMutation.mutate({ id: entry.id, status: "cancelled" })}
                          >
                            Batalkan
                          </Button>
                        </div>
                      ) : entry.status === "cancelled" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={setStatusMutation.isPending}
                          onClick={() => setStatusMutation.mutate({ id: entry.id, status: "open" })}
                        >
                          Buka lagi
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <TableNote>
          Bot WhatsApp mengecek ulang jam kosong tiap 10 menit dan mengabari tamu sekali; entri yang tanggalnya lewat
          ditutup otomatis.
        </TableNote>
      </Card>
    </div>
  );
}

function WaitlistForm({
  outlets,
  defaultBranch,
  onDone,
}: {
  outlets: Parameters<typeof OutletSelect>[0]["outlets"];
  defaultBranch: string;
  onDone: () => void;
}) {
  const create = useCreateWaitlist();
  const [branchId, setBranchId] = useState(defaultBranch);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(() => todayWib());
  const [period, setPeriod] = useState<WaitlistEntry["period"]>("");
  const [people, setPeople] = useState("1");
  const [note, setNote] = useState("");
  const error = create.error instanceof Error ? create.error.message : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      branch_id: branchId,
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      visit_date: date,
      period,
      people: Math.max(1, Number(people) || 1),
      note: note.trim() || undefined,
    });
    onDone();
  }

  return (
    <Card className="p-4">
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 md:grid-cols-3">
        <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} required ariaLabel="Toko daftar tunggu" className={SELECT} />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama tamu" required aria-label="Nama tamu" />
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Nomor WhatsApp (0812…)" required aria-label="Nomor WhatsApp" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Tanggal kunjungan" />
        <select value={period} onChange={(e) => setPeriod(e.target.value as WaitlistEntry["period"])} className={SELECT} aria-label="Waktu">
          {(Object.keys(PERIOD_LABEL) as WaitlistEntry["period"][]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABEL[p]}
            </option>
          ))}
        </select>
        <Input type="number" min={1} max={10} value={people} onChange={(e) => setPeople(e.target.value)} aria-label="Jumlah orang" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="md:col-span-2" aria-label="Catatan" />
        <div className="flex items-center justify-end gap-2">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <Button type="submit" disabled={create.isPending || !branchId} className="purchasing-main-button">
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Simpan
          </Button>
        </div>
      </form>
    </Card>
  );
}
