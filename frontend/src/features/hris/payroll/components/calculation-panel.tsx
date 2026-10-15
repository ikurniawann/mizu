"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { CalculatePayrollResult } from "../types";
import { useCalculatePayroll } from "../mutations";

/** Hitung run draft langsung di halaman detail: opsi THR dan hasilnya inline. */
export function CalculationPanel({ runId, hasDetails }: { runId: string; hasDetails: boolean }) {
  const [includeThr, setIncludeThr] = useState(false);
  const [result, setResult] = useState<CalculatePayrollResult | null>(null);
  const calculate = useCalculatePayroll();

  function handleCalculate() {
    calculate.mutate(
      { runId, includeThr },
      {
        onSuccess: (res) => {
          setResult(res);
          toast.success(`Payroll dihitung untuk ${res.summary?.total_employees ?? 0} karyawan`);
        },
        onError: (error) => toast.error(error.message || "Gagal menghitung payroll"),
      }
    );
  }

  const s = result?.summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hitung Payroll</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox checked={includeThr} onCheckedChange={(v) => setIncludeThr(v === true)} />
            Sertakan THR
          </label>
          <Button variant="primary" onClick={handleCalculate} disabled={calculate.isPending}>
            {calculate.isPending ? "Menghitung…" : hasDetails ? "Hitung Ulang" : "Hitung Payroll"}
          </Button>
        </div>
        {includeThr && (
          <p className="text-xs text-muted-foreground">
            THR ditambahkan sebesar 1× gaji pokok entitas ini untuk karyawan yang sudah bekerja ≥ 1 tahun.
          </p>
        )}

        {result && (
          <div className="space-y-3">
            {result.warning ? (
              <div className="rounded-xl bg-warning-soft p-3 text-sm">⚠️ {result.warning}</div>
            ) : result.attendance_period?.label ? (
              <p className="text-xs text-muted-foreground">
                Absensi periode {result.attendance_period.label} (sudah di-closing)
              </p>
            ) : null}
            <p className="flex items-center gap-2 text-sm font-semibold text-forest">
              <CheckCircleIcon className="h-5 w-5" />
              {s?.total_employees ?? 0} karyawan dihitung
            </p>
            {(s?.other_entity_count ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {s?.other_entity_count} karyawan hanya digaji entitas lain (tidak diproses di run ini).
              </p>
            )}
            {(s?.skipped?.length ?? 0) > 0 && (
              <div className="rounded-xl bg-danger-soft p-3">
                <p className="text-sm font-semibold">{s?.skipped?.length} karyawan dilewati</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {s?.skipped?.map((k) => (
                    <li key={k.employee_id}>
                      {k.full_name} <span className="text-xs text-muted-foreground">— {k.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(s?.allocation_warnings?.length ?? 0) > 0 && (
              <div className="rounded-xl bg-warning-soft p-3">
                <p className="text-sm font-semibold">{s?.allocation_warnings?.length} karyawan belum punya toko</p>
                <p className="mb-1 text-xs text-muted-foreground">
                  Biayanya masuk &quot;Tanpa toko&quot; di laporan Biaya Gaji per Toko dan jurnal. Atur di HRIS → Master
                  Data → Penempatan Karyawan, lalu hitung ulang.
                </p>
                <ul className="space-y-0.5 text-sm">
                  {s?.allocation_warnings?.map((w) => (
                    <li key={w.employee_id}>
                      {w.full_name} <span className="text-xs text-muted-foreground">— {w.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
