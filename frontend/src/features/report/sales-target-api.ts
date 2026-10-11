import { apiDelete, apiGet, apiPatch, apiPost, apiPut, buildListUrl } from "@/lib/api-client";

export interface SalesTargetPermissions { create: boolean; update: boolean; delete: boolean }
export interface SalesTargetFilters { year: number; branch_id?: string }
export interface SalesTargetInput { branch_id: string; month: string; amount: number }
export interface MonthlySalesTarget extends SalesTargetInput { id: string; branch_name: string }
export interface SalesTargetMonth { month: string; sales: number; target: number | null; target_count: number }
export interface SalesTargetReport {
  year: number;
  outlets: { id: string; name: string }[];
  outlet_count: number;
  months: SalesTargetMonth[];
}
export interface SalesTargetYear { year: number; months: number[]; total: number }
export interface SalesTargetYears { outlets: SalesTargetReport["outlets"]; years: SalesTargetYear[] }
export interface TargetCellChange { branch_id: string; month: number; amount: number | null; previous: number | null }

export const salesTargetApi = {
  report: (filters: SalesTargetFilters) => apiGet<{ data: SalesTargetReport }>(buildListUrl("/api/reports/sales-vs-target", { ...filters })).then((r) => r.data),
  targets: (filters: SalesTargetFilters) => apiGet<{ data: MonthlySalesTarget[] }>(buildListUrl("/api/reports/sales-targets", { ...filters })).then((r) => r.data),
  create: (body: SalesTargetInput) => apiPost<{ data: MonthlySalesTarget }>("/api/reports/sales-targets", body).then((r) => r.data),
  update: (id: string, body: SalesTargetInput) => apiPatch<{ data: MonthlySalesTarget }>(`/api/reports/sales-targets/${id}`, body).then((r) => r.data),
  delete: (id: string) => apiDelete(`/api/reports/sales-targets/${id}`),
  years: () => apiGet<{ data: SalesTargetYears }>("/api/reports/sales-target-years").then((r) => r.data),
  saveYear: (year: number, changes: TargetCellChange[]) => apiPut(`/api/reports/sales-target-years/${year}`, { changes }),
  deleteYear: (year: number) => apiDelete(`/api/reports/sales-target-years/${year}`),
};
