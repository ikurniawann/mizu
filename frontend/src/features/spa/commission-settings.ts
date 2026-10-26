"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call, send } from "./api";

export interface CommissionSetting {
  variant_id: string;
  treatment_name: string;
  variant_name: string;
  duration_min: number;
  is_active: boolean;
  values: [number | null, number | null, number | null];
}
export type CommissionDrafts = Record<string, [string, string, string]>;
export function commissionChanges(rows: CommissionSetting[], drafts: CommissionDrafts) {
  return Object.entries(drafts).flatMap(([variant_id, values]) => {
    const row = rows.find((r) => r.variant_id === variant_id);
    if (!row) throw new Error("Varian tidak ditemukan. Muat ulang halaman.");
    if (values.every((v, i) => v === (row.values[i] == null ? "" : String(row.values[i])))) return [];
    if (values.some((v) => !/^\d+$/.test(v) || Number(v) > 999999999999)) {
      throw new Error(`Isi nominal rupiah bulat untuk ketiga level: ${row.treatment_name} — ${row.variant_name}. Nilai 0 diperbolehkan.`);
    }
    return [{ variant_id, values: values.map(Number) }];
  });
}
const key = ["spa", "commission-settings"] as const;
export const useCommissionSettings = () => useQuery({ queryKey: key, queryFn: () => call<CommissionSetting[]>("/api/spa/commission-settings") });
export function useSaveCommissionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: { variant_id: string; values: number[] }[]) => send<CommissionSetting[]>("/api/spa/commission-settings", { rows }, "PUT"),
    onSuccess: (rows) => {
      qc.setQueryData(key, rows);
      void qc.invalidateQueries({ queryKey: ["spa", "me"] });
    },
  });
}
export const useMyCommissionRates = () => useQuery({
  queryKey: ["spa", "me", "commission-rates"],
  queryFn: () => call<{ level: number; rates: { variant_id: string; treatment_name: string; variant_name: string; value: number | null }[] }>("/api/spa/me/commission-rates"),
});
