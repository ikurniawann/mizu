"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusIcon, PencilIcon } from "@heroicons/react/24/outline";
import { formatDate, formatRupiah } from "@/lib/format";
import { EntityTabs, useEntityParam } from "@/features/hris/payroll";
import { useSalaryList } from "../queries";

export function SalaryPage() {
  const router = useRouter();

  const salaryQuery = useSalaryList();
  const salaries = salaryQuery.data ?? [];
  // Gaji aktif tanpa entitas tidak milik tab mana pun: tampil sebagai peringatan, bukan tab.
  const unassigned = salaries.filter((s) => s.is_active !== false && !s.company_id);
  const { entity, setEntity, entities, loading: entitiesLoading } = useEntityParam();
  const entityName = entities.find((e) => e.id === entity)?.name ?? "";
  const visible = salaries.filter((s) => s.company_id === entity);
  const loading = salaryQuery.isLoading || entitiesLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Salary Structure</h1>
          <p className="text-sm text-gray-500">Kelola struktur gaji karyawan</p>
        </div>
        <Button onClick={() => router.push(`/dashboard/hris/salary/insert${entity ? `?entity=${entity}` : ""}`)} className="bg-pink-600 hover:bg-pink-700">
          <PlusIcon className="w-4 h-4 mr-2" />
          Tambah Salary
        </Button>
      </div>

      {unassigned.length > 0 && (
        <div className="rounded-2xl bg-warning-soft p-4 text-sm">
          <p className="font-semibold">{unassigned.length} struktur gaji aktif belum punya entitas pembayar</p>
          <p className="mt-0.5 text-muted-foreground">
            Gaji ini tidak ikut payroll entitas mana pun. Buat versi baru dengan entitas pembayar lewat
            &quot;Tambah Salary&quot;; versi tanpa entitas otomatis digantikan.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {unassigned.map((s) => (
              <li key={s.id}>
                <Link href={`/dashboard/hris/salary/${s.id}`} className="font-medium text-forest underline-offset-4 hover:underline">
                  {s.employee?.full_name}
                </Link>
                <span className="text-xs text-muted-foreground"> · {s.employee?.nip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <EntityTabs value={entity} entities={entities} onChange={setEntity} />

      {/* Salary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Salary Structure{entityName ? ` — ${entityName}` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Karyawan</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Gaji Pokok</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Tunjangan Tetap</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Transport</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Makan</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Status PTKP</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Efektif</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-500">
                      {entityName ? `Belum ada struktur gaji untuk ${entityName}.` : "Belum ada entitas aktif."}
                    </td>
                  </tr>
                ) : (
                  visible.map((salary) => (
                    <tr key={salary.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-medium">{salary.employee?.full_name}</div>
                          <div className="text-xs text-gray-500">{salary.employee?.nip}</div>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatRupiah(salary.base_salary)}
                      </td>
                      <td className="text-right py-3 px-4">
                        {formatRupiah(salary.fixed_allowance)}
                      </td>
                      <td className="text-right py-3 px-4">
                        {formatRupiah(salary.transport_allowance)}
                      </td>
                      <td className="text-right py-3 px-4">
                        {formatRupiah(salary.meal_allowance)}
                      </td>
                      <td className="py-3 px-4">
                        <Badge>{salary.ptkp_status}</Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        {formatDate(salary.effective_date)}
                      </td>
                      <td className="text-right py-3 px-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/dashboard/hris/salary/${salary.id}`)}
                        >
                          <PencilIcon className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
