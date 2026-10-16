"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SalaryRuleState } from "@/lib/hris/salary-form";

const selectClass =
  "mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500";

const PAY_BASIS_OPTIONS: { value: SalaryRuleState["pay_basis"]; label: string }[] = [
  { value: "monthly", label: "Bulanan penuh" },
  { value: "monthly_prorated", label: "Bulanan prorata hari hadir" },
  { value: "daily", label: "Upah harian × hari hadir" },
];

const OVERTIME_OPTIONS: { value: SalaryRuleState["overtime_scheme"]; label: string }[] = [
  { value: "standard", label: "Standar (1,5× / 2× upah per jam)" },
  { value: "production", label: "Tim produksi (tarif per jam)" },
  { value: "freelance", label: "Freelance (upah harian / 8, hari istirahat)" },
  { value: "daily_worker", label: "Pekerja harian (upah harian / 5)" },
];

const ALLOWANCE_MODES: { key: "transport_mode" | "meal_mode" | "position_mode"; label: string }[] = [
  { key: "transport_mode", label: "Tunjangan Transport" },
  { key: "meal_mode", label: "Tunjangan Makan" },
  { key: "position_mode", label: "Tunjangan Jabatan" },
];

interface SalaryRuleFieldsProps {
  values: SalaryRuleState;
  onChange: <K extends keyof SalaryRuleState>(field: K, value: SalaryRuleState[K]) => void;
}

/** Aturan perhitungan slip (rule penggajian Odoo): basis gaji, pembagi hari, mode tunjangan, lembur. */
export function SalaryRuleFields({ values, onChange }: SalaryRuleFieldsProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Aturan Perhitungan</h3>
      <p className="text-xs text-gray-500 mb-3">
        Menentukan cara gaji pokok, tunjangan, dan lembur dihitung di slip. Default (bulanan penuh, flat, standar)
        sama dengan perilaku sebelumnya.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="pay_basis">Basis gaji pokok</Label>
          <select
            id="pay_basis"
            value={values.pay_basis}
            onChange={(e) => onChange("pay_basis", e.target.value as SalaryRuleState["pay_basis"])}
            className={selectClass}
          >
            {PAY_BASIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {values.pay_basis === "daily" && (
            <p className="mt-1 text-xs text-amber-700">Gaji Pokok diisi upah per hari.</p>
          )}
          {values.pay_basis === "daily" && values.overtime_scheme === "standard" && (
            <p className="mt-1 text-xs text-red-600">
              Skema lembur standar memakai gaji pokok ÷ 173 — untuk upah harian hasilnya sangat kecil. Pertimbangkan
              skema pekerja harian atau freelance.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="working_days_divisor">Pembagi hari kerja</Label>
          <Input
            id="working_days_divisor"
            type="number"
            min={1}
            max={31}
            step="1"
            value={values.working_days_divisor}
            onChange={(e) => onChange("working_days_divisor", e.target.value)}
            placeholder="Otomatis dari jadwal"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-gray-500">
            Hari struktur gaji (mis. 20, 25, 26). Dipakai untuk prorata, tunjangan per hari, dan potongan per hari.
          </p>
        </div>
        {ALLOWANCE_MODES.map(({ key, label }) => (
          <div key={key}>
            <Label htmlFor={key}>{label}</Label>
            <select
              id={key}
              value={values[key]}
              onChange={(e) => onChange(key, e.target.value as SalaryRuleState[typeof key])}
              className={selectClass}
            >
              <option value="flat">Penuh per bulan</option>
              <option value="per_day">Per hari hadir (÷ pembagi × hari)</option>
            </select>
          </div>
        ))}
        <div>
          <Label htmlFor="health_min_service_days">Subsidi BPJS Kes: minimal masa kerja (hari)</Label>
          <Input
            id="health_min_service_days"
            type="number"
            min={0}
            max={3650}
            step="1"
            value={values.health_min_service_days}
            onChange={(e) => onChange("health_min_service_days", e.target.value)}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-gray-500">0 = selalu dibayar. Odoo: 365 hari sejak tanggal masuk.</p>
        </div>
        <div className="col-span-2">
          <Label htmlFor="overtime_scheme">Skema lembur</Label>
          <select
            id="overtime_scheme"
            value={values.overtime_scheme}
            onChange={(e) => onChange("overtime_scheme", e.target.value as SalaryRuleState["overtime_scheme"])}
            className={selectClass}
          >
            {OVERTIME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
