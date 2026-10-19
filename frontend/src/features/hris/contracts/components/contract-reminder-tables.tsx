"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExpiringContractsData } from "@/features/users/api";
import { formatDate } from "@/lib/format";
import { EMPLOYMENT_STATUS_LABELS, type EmploymentStatus } from "@/types/hris";

/**
 * Tabel lengkap untuk kartu pengingat kontrak (ContractExpiryBanner): karyawan
 * aktif tanpa kontrak aktif dan masa percobaan yang berakhir. Data dari
 * /api/hris/contracts/expiring (seluruh baris sekaligus): pencarian & halaman
 * dilakukan di browser, sama gaya dengan tabel kontrak di halaman ini.
 */

const PAGE_SIZE = 15;

const EXTRA_STATUS_LABELS: Record<string, string> = {
  intern: "Magang",
  freelance: "Freelance",
  daily_worker: "Pekerja Harian",
};

function statusLabel(status: string): string {
  return EMPLOYMENT_STATUS_LABELS[status as EmploymentStatus] ?? EXTRA_STATUS_LABELS[status] ?? status;
}

function manageHref(employeeId: string): string {
  return `/dashboard/employees/${employeeId}?tab=contracts`;
}

function usePaged<T>(rows: T[], match: (row: T, q: string) => boolean) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((row) => match(row, q)) : rows;
  }, [rows, query, match]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return {
    input,
    setInput,
    apply: () => {
      setQuery(input);
      setPage(1);
    },
    clear: () => {
      setInput("");
      setQuery("");
      setPage(1);
    },
    filtered,
    visible,
    page: current,
    totalPages,
    setPage,
  };
}

function SearchBar({ value, onChange, onApply, onClear }: {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Cari nama karyawan..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onApply()}
          className="h-10 bg-white pl-10 pr-9"
        />
        {value ? (
          <button
            type="button"
            aria-label="Hapus pencarian"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </label>
      <Button variant="outline" className="h-10" onClick={onApply}>
        Terapkan
      </Button>
    </div>
  );
}

function Pager({ page, totalPages, total, unit, onPage }: {
  page: number;
  totalPages: number;
  total: number;
  unit: string;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-gray-600">
      <p>
        Halaman {page} dari {totalPages} · {total} {unit}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Sebelumnya
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Berikutnya
        </Button>
      </div>
    </div>
  );
}

function TableShell({ loading, empty, children }: { loading: boolean; empty: string | null; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white shadow-sm">
      {loading ? (
        <div className="flex justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : empty ? (
        <p className="py-14 text-center text-sm text-gray-400">{empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

const TH = "px-4 py-3 font-semibold";
const HEAD_ROW = "border-b border-gray-200/70 bg-gray-50/60 text-left text-xs uppercase tracking-wide text-gray-500";
const BODY_ROW = "border-b border-gray-100 last:border-0 hover:bg-gray-50/60";

type NoContractRow = ExpiringContractsData["noContract"][number];
const matchName = (row: { employee_name: string }, q: string) => row.employee_name.toLowerCase().includes(q);

export function NoContractTable({ rows, loading }: { rows: NoContractRow[]; loading: boolean }) {
  const p = usePaged(rows, matchName);
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        PKWT wajib tertulis sebelum karyawan mulai bekerja (PP 35/2021). Aktifkan draft yang ada atau buat kontraknya
        dari detail karyawan.
      </p>
      <SearchBar value={p.input} onChange={p.setInput} onApply={p.apply} onClear={p.clear} />
      <TableShell
        loading={loading}
        empty={p.filtered.length === 0 ? (rows.length === 0 ? "Semua karyawan aktif sudah punya kontrak aktif." : "Tidak ada karyawan yang cocok.") : null}
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className={HEAD_ROW}>
              <th className={TH}>Karyawan</th>
              <th className={TH}>Status Kepegawaian</th>
              <th className={TH}>Tanggal Masuk</th>
              <th className={TH}>Kontrak</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {p.visible.map((item) => (
              <tr key={item.employee_id} className={BODY_ROW}>
                <td className="px-4 py-3 font-medium text-gray-900">{item.employee_name}</td>
                <td className="px-4 py-3">{statusLabel(item.employment_status)}</td>
                <td className="px-4 py-3">{formatDate(item.join_date, "—")}</td>
                <td className="px-4 py-3">
                  {item.draft_contract_number ? (
                    <Badge variant="warning">Draft {item.draft_contract_number}</Badge>
                  ) : (
                    <Badge variant="destructive">Belum ada kontrak</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={manageHref(item.employee_id)}
                    className="text-sm font-medium text-pink-600 hover:text-pink-700 hover:underline"
                  >
                    {item.draft_contract_number ? "Aktifkan draft" : "Buat kontrak"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
      <Pager page={p.page} totalPages={p.totalPages} total={p.filtered.length} unit="karyawan" onPage={p.setPage} />
    </div>
  );
}

type ProbationRow = ExpiringContractsData["probations"][number];

function daysLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Lewat ${Math.abs(daysLeft)} hr`;
  if (daysLeft === 0) return "Hari ini";
  return `${daysLeft} hari`;
}

export function ProbationTable({ rows, loading, days }: { rows: ProbationRow[]; loading: boolean; days: number }) {
  const p = usePaged(rows, matchName);
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Masa percobaan PKWTT yang berakhir dalam {days} hari. Tentukan kelanjutan karyawan sebelum masa percobaan selesai.
      </p>
      <SearchBar value={p.input} onChange={p.setInput} onApply={p.apply} onClear={p.clear} />
      <TableShell
        loading={loading}
        empty={p.filtered.length === 0 ? (rows.length === 0 ? "Tidak ada masa percobaan yang segera berakhir." : "Tidak ada karyawan yang cocok.") : null}
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className={HEAD_ROW}>
              <th className={TH}>Karyawan</th>
              <th className={TH}>No. Kontrak</th>
              <th className={TH}>Jabatan</th>
              <th className={TH}>Probation Berakhir</th>
              <th className={TH}>Sisa Waktu</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {p.visible.map((item) => (
              <tr key={item.contract_id} className={BODY_ROW}>
                <td className="px-4 py-3 font-medium text-gray-900">{item.employee_name}</td>
                <td className="px-4 py-3 font-mono text-xs">{item.contract_number}</td>
                <td className="px-4 py-3 text-gray-600">{item.position_title ?? "—"}</td>
                <td className="px-4 py-3">{formatDate(item.probation_end_date, "—")}</td>
                <td className="px-4 py-3">
                  <Badge variant={item.days_left <= 14 ? "destructive" : "info"}>{daysLabel(item.days_left)}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={manageHref(item.employee_id)}
                    className="text-sm font-medium text-pink-600 hover:text-pink-700 hover:underline"
                  >
                    Kelola
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
      <Pager page={p.page} totalPages={p.totalPages} total={p.filtered.length} unit="karyawan" onPage={p.setPage} />
    </div>
  );
}
