import { call, withQuery } from "./api";

export interface RushHourReportParams {
  from: string;
  to: string;
  branch_id?: string;
}
export interface RushHourReport {
  from: string;
  to: string;
  total_bookings: number;
  peak_bookings: number;
  peak_hours: number[];
  hourly: { hour: number; bookings: number }[];
}

export function getRushHourReport(params: RushHourReportParams, signal?: AbortSignal) {
  return call<RushHourReport>(withQuery("/api/spa/reports/rush-hour", { ...params }), { signal });
}
