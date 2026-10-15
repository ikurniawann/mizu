"use client";

import { formatRupiah } from "@/lib/format";
import {
  ALLOCATION_BASIS_LABEL,
  NO_STORE_LABEL,
  formatQty,
  formatRatio,
} from "@/lib/payroll/store-allocation";
import type { SlipAllocation } from "../types";

/** Chip toko + porsi untuk tabel detail run. */
export function AllocationChips({ allocations }: { allocations?: SlipAllocation[] }) {
  if (!allocations || allocations.length === 0) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {allocations.map((a) => (
        <span
          key={a.branch_id ?? "none"}
          title={`${ALLOCATION_BASIS_LABEL[a.basis] ?? a.basis} · ${formatQty(a.days)} hari · ${formatQty(a.hours)} jam`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
            a.branch_id ? "border-gray-200 bg-white text-gray-700" : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          {a.branch_name ?? NO_STORE_LABEL}
          {allocations.length > 1 && <b>{formatRatio(a.ratio)}</b>}
        </span>
      ))}
    </div>
  );
}

/**
 * "Rincian per toko" di slip gaji — hanya bila biaya slip terbagi ke lebih dari
 * satu toko (slip satu toko tetap ringkas).
 */
export function SlipStoreBreakdown({ allocations }: { allocations?: SlipAllocation[] }) {
  if (!allocations || allocations.length < 2) return null;
  return (
    <div>
      <h3 className="mb-2 text-lg font-semibold text-gray-700">Rincian per toko</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-3 py-2">Toko</th>
              <th className="px-3 py-2 text-right">Hari</th>
              <th className="px-3 py-2 text-right">Jam</th>
              <th className="px-3 py-2 text-right">Porsi</th>
              <th className="px-3 py-2 text-right">Gaji kotor bagian toko</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.branch_id ?? "none"} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium text-gray-800">{a.branch_name ?? NO_STORE_LABEL}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(a.days)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(a.hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRatio(a.ratio)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(a.gross_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Satu slip dan satu perhitungan PPh 21/BPJS; biaya dibagi ke toko sesuai{" "}
        {(ALLOCATION_BASIS_LABEL[allocations[0].basis] ?? "kehadiran").toLowerCase()}.
      </p>
    </div>
  );
}
