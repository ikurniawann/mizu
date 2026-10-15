"use client";

import Link from "next/link";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import { NO_STORE_LABEL } from "@/lib/payroll/store-allocation";
import type { RunStoreAllocation } from "../types";

/**
 * Ringkasan alokasi biaya run per toko + peringatan slip tanpa toko (karyawan
 * tanpa penempatan) di halaman detail run.
 */
export function StoreAllocationCard({
  allocation,
  slipCount,
  isDraft,
}: {
  allocation?: RunStoreAllocation;
  slipCount: number;
  isDraft: boolean;
}) {
  if (!allocation || slipCount === 0) return null;
  const missing = slipCount - (allocation.allocated_slips ?? 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Alokasi Biaya per Toko</span>
          <Link href="/dashboard/hris/payroll/store-costs" className="text-sm font-normal text-pink-600 hover:underline">
            Laporan lengkap →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allocation.unassigned.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <b>{allocation.unassigned.length} karyawan tanpa toko</b> — biayanya masuk &quot;{NO_STORE_LABEL}&quot;:{" "}
              {allocation.unassigned.map((u) => u.employee?.full_name ?? u.employee_id).join(", ")}.{" "}
              Atur di{" "}
              <Link href="/dashboard/hris/placements" className="underline">
                Penempatan Karyawan
              </Link>
              {isDraft ? ", lalu hitung ulang run ini." : "."}
            </div>
          </div>
        )}
        {missing > 0 && (
          <p className="text-xs text-gray-500">
            {missing} slip dihitung sebelum fitur alokasi toko{isDraft ? " — hitung ulang untuk membaginya." : "."}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allocation.stores.map((s) => (
            <div
              key={s.branch_id ?? "none"}
              className={`rounded-lg border p-3 ${s.branch_id ? "border-gray-200" : "border-amber-200 bg-amber-50/50"}`}
            >
              <p className="text-sm font-semibold text-gray-900">{s.branch_name ?? NO_STORE_LABEL}</p>
              <p className="text-xs text-gray-500">
                {s.employee_count} karyawan · {Number(s.fte).toLocaleString("id-ID", { maximumFractionDigits: 2 })} FTE
              </p>
              <p className="mt-2 text-lg font-bold text-gray-900">{formatRupiah(s.labor_cost)}</p>
              <p className="text-xs text-gray-500">
                Gaji kotor {formatRupiah(s.gross_amount)} + beban perusahaan {formatRupiah(s.employer_contribution_amount)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
