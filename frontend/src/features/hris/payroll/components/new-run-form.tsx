"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTH_NAMES_ID } from "@/lib/hris/month-label";
import { useCreatePayrollRun } from "../mutations";

/** Buat payroll periode untuk entitas tab aktif — form inline, bukan popup. */
export function NewRunForm({ companyId, companyName }: { companyId: string; companyName: string }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];
  const createMutation = useCreatePayrollRun();

  function handleCreate() {
    createMutation.mutate(
      { company_id: companyId, period_month: month, period_year: year },
      {
        onSuccess: () => toast.success(`Payroll ${MONTH_NAMES_ID[month - 1]} ${year} untuk ${companyName} dibuat`),
        onError: (error) => toast.error(error.message || "Gagal membuat payroll"),
      }
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 py-4">
        <div className="w-full sm:w-48">
          <Label htmlFor="run-month">Bulan</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
            <SelectTrigger id="run-month" className="mt-1">
              <SelectValue placeholder="Pilih bulan" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES_ID.map((name, index) => (
                <SelectItem key={name} value={String(index + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-32">
          <Label htmlFor="run-year">Tahun</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
            <SelectTrigger id="run-year" className="mt-1">
              <SelectValue placeholder="Tahun" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="primary" onClick={handleCreate} disabled={createMutation.isPending || !companyId}>
          <PlusIcon className="mr-2 h-4 w-4" />
          {createMutation.isPending ? "Membuat…" : `Buat Payroll ${companyName}`}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          Hanya karyawan yang punya struktur gaji di {companyName} yang dihitung. Karyawan yang digaji beberapa entitas
          mendapat slip dari tiap entitas.
        </p>
      </CardContent>
    </Card>
  );
}
