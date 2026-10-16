"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useSalaryEmployees } from "@/features/hris/salary";
import { formatRupiah } from "@/lib/format";
import {
  MANUAL_INPUT_CODES,
  MANUAL_INPUT_CSV_EXAMPLE,
  MANUAL_INPUT_KIND_LABELS,
  manualInputKind,
  manualInputLabel,
} from "@/lib/payroll/manual-inputs";
import { usePayrollInputs } from "../queries";
import { useImportPayrollInputs, useSavePayrollInput } from "../mutations";

const EMPTY = { employee_id: "", code: "BONUS", amount: "", note: "" };

/**
 * Komponen manual slip (bonus, insentif, denda, …) untuk run draft. Hitung ulang
 * payroll setelah mengubahnya agar masuk ke slip.
 */
export function ManualInputsCard({ runId }: { runId: string }) {
  const inputsQuery = usePayrollInputs(runId);
  const employeesQuery = useSalaryEmployees();
  const save = useSavePayrollInput(runId);
  const importCsv = useImportPayrollInputs(runId);
  const [form, setForm] = useState(EMPTY);
  const [csv, setCsv] = useState("");
  const [showImport, setShowImport] = useState(false);

  const rows = inputsQuery.data ?? [];
  const employeeOptions = (employeesQuery.data ?? []).map((e) => ({
    value: e.id,
    label: e.full_name,
    description: e.nip ?? undefined,
  }));

  function handleAdd() {
    const amount = Number(form.amount.replace(/[^0-9]/g, ""));
    if (!form.employee_id || !amount) {
      toast.error("Pilih karyawan dan isi nominal");
      return;
    }
    save.mutate(
      { employee_id: form.employee_id, code: form.code, amount, note: form.note.trim() || null },
      {
        onSuccess: () => {
          toast.success("Komponen manual tersimpan — hitung ulang payroll agar masuk ke slip");
          setForm((f) => ({ ...EMPTY, employee_id: f.employee_id }));
        },
        onError: (error) => toast.error(error.message || "Gagal menyimpan"),
      }
    );
  }

  function handleRemove(employeeId: string, code: string) {
    save.mutate(
      { employee_id: employeeId, code, amount: 0 },
      {
        onSuccess: () => toast.success("Komponen dihapus — hitung ulang payroll"),
        onError: (error) => toast.error(error.message || "Gagal menghapus"),
      }
    );
  }

  function handleImport() {
    if (!csv.trim()) {
      toast.error("Tempel isi CSV dulu");
      return;
    }
    importCsv.mutate(csv, {
      onSuccess: (res) => {
        if (res.errors.length > 0) {
          toast.warning(
            `${res.imported} baris masuk, ${res.errors.length} gagal: ` +
              res.errors
                .slice(0, 3)
                .map((e) => `baris ${e.line} ${e.message}`)
                .join("; ")
          );
        } else {
          toast.success(`${res.imported} komponen diimport — hitung ulang payroll`);
          setCsv("");
          setShowImport(false);
        }
      },
      onError: (error) => toast.error(error.message || "Gagal import"),
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Komponen Manual</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
          {showImport ? "Tutup import" : "Import CSV"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Bonus, insentif, natura, denda, dan potongan lain per karyawan untuk run ini. Perubahan masuk ke slip setelah
          payroll dihitung ulang.
        </p>

        {showImport && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              Format per baris: <code>nip,kode,nominal,catatan</code>. Kode:{" "}
              {MANUAL_INPUT_CODES.map((c) => c.code).join(", ")}.
            </p>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={MANUAL_INPUT_CSV_EXAMPLE}
              rows={5}
              className="w-full rounded-md border border-gray-200 p-2 font-mono text-xs"
            />
            <Button size="sm" onClick={handleImport} disabled={importCsv.isPending}>
              {importCsv.isPending ? "Mengimport…" : "Import"}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1.5fr_1fr_1.5fr_auto] md:items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Karyawan</label>
            <Combobox
              options={employeeOptions}
              value={form.employee_id}
              onChange={(value) => setForm((f) => ({ ...f, employee_id: value }))}
              placeholder={employeesQuery.isLoading ? "Memuat…" : "Pilih karyawan"}
              searchPlaceholder="Cari nama atau NIP…"
              emptyMessage="Karyawan tidak ditemukan"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Komponen</label>
            <select
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
            >
              {MANUAL_INPUT_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nominal (Rp)</label>
            <Input
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^0-9]/g, ""));
                setForm((f) => ({ ...f, amount: n ? n.toLocaleString("id-ID") : "" }));
              }}
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Catatan</label>
            <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <Button onClick={handleAdd} disabled={save.isPending}>
            Simpan
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-3 font-medium">Karyawan</th>
                <th className="py-2 pr-3 font-medium">Komponen</th>
                <th className="py-2 pr-3 text-right font-medium">Nominal</th>
                <th className="py-2 pr-3 font-medium">Catatan</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-400">
                    {inputsQuery.isLoading ? "Memuat…" : "Belum ada komponen manual"}
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const kind = manualInputKind(row.code);
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-900">{row.employee_name}</div>
                      <div className="text-xs text-gray-400">{row.employee_nip ?? "—"}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{manualInputLabel(row.code)}</div>
                      {kind && <div className="text-xs text-gray-400">{MANUAL_INPUT_KIND_LABELS[kind]}</div>}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${kind === "deduction" ? "text-red-600" : ""}`}
                    >
                      {kind === "deduction" ? "−" : ""}
                      {formatRupiah(Number(row.amount))}
                    </td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-gray-600" title={row.note ?? ""}>
                      {row.note || "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-red-600"
                        disabled={save.isPending}
                        onClick={() => handleRemove(row.employee_id, row.code)}
                      >
                        Hapus
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
