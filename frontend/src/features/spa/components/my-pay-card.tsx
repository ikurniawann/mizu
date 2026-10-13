"use client";

import { Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate, formatRupiah } from "@/lib/format";
import { PAY_KIND_LABEL, PAY_STATUS_LABEL, PAY_STATUS_VARIANT } from "../payroll";
import { useMyPay } from "../queries";

/** Aplikasi terapis → Pembayaran (revisi R1): komisi tengah bulan & gaji reguler yang sudah disetujui. */
export function MyPayCard() {
  const pay = useMyPay();
  const list = pay.data ?? [];
  return (
    <Card className="gap-3 px-5" id="pembayaran">
      <p className="flex items-center gap-2 font-semibold">
        <Banknote className="size-5 text-muted-foreground" /> Pembayaran
      </p>
      {pay.isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : pay.error ? (
        <p className="text-sm text-danger">{pay.error.message}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada pembayaran yang disetujui.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((l) => (
            <li key={l.id} className="space-y-1 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{l.run_kind ? PAY_KIND_LABEL[l.run_kind] : "Pembayaran"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.period_start && l.period_end ? `${formatDate(l.period_start)} – ${formatDate(l.period_end)}` : ""}
                    {l.pay_date ? ` · dibayar ${formatDate(l.pay_date)}` : ""}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{formatRupiah(l.total_idr)}</span>
                  {l.run_status && <Badge variant={PAY_STATUS_VARIANT[l.run_status]}>{PAY_STATUS_LABEL[l.run_status]}</Badge>}
                </span>
              </div>
              <p className="text-xs text-body">
                {l.base_salary_idr + l.allowance_idr > 0 ? `Gaji ${formatRupiah(l.base_salary_idr + l.allowance_idr)} · ` : ""}
                Komisi {formatRupiah(l.commission_idr)} ({l.commission_count} treatment)
                {l.bonus_idr > 0 ? ` · Bonus ${formatRupiah(l.bonus_idr)}` : ""}
                {l.deduction_idr > 0 ? ` · Potongan ${formatRupiah(l.deduction_idr)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
