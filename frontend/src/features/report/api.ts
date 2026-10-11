import { call, withQuery } from "@/features/spa/api";

export type ReportInterval = "daily" | "monthly" | "yearly";
export interface TrendReportParams {
  from: string;
  to: string;
  branch_id?: string;
  interval: ReportInterval;
}
export interface TrendReport {
  from: string;
  to: string;
  total_bookings: number;
  interval: ReportInterval;
  periods: { period: string; bookings: number }[];
}

export function getTrendReport(params: TrendReportParams, signal?: AbortSignal) {
  return call<TrendReport>(withQuery("/api/spa/reports/trend", { ...params }), { signal });
}

export interface RatingReport {
  from: string;
  to: string;
  total_ratings: number;
  average_rating: number;
  bookings: { id: string; booking_code: string; customer_name: string; branch_name: string; therapist_id: string; therapist_name: string; scheduled_at: string; rating: number }[];
  therapists: { therapist_id: string; therapist_name: string; total_ratings: number; average_rating: number }[];
}

export function getRatingReport(params: { from: string; to: string; branch_id?: string }, signal?: AbortSignal) {
  return call<RatingReport>(withQuery("/api/spa/reports/rating", params), { signal });
}
