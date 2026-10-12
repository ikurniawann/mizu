"use client";

import Link from "next/link";
import { formatTime } from "@/lib/format";
import { groupMySchedule, type MyBooking } from "../my-schedule";
import { useMySchedule, useSpaMe } from "../queries";
import { addDaysToDate, wibDateOf } from "../time";

/** Jumlah hari inklusif start..end (YYYY-MM-DD), dibatasi 31 (batas API jadwal terapis). */
function spanDays(start: string, end: string): number {
  let days = 1;
  while (days < 31 && addDaysToDate(start, days) <= end) days++;
  return days;
}

/** Booking terapis bulan tampil, dikelompokkan per tanggal WIB (satu query untuk semua sel). */
function useMonthBookings(start: string, end: string) {
  const me = useSpaMe();
  const isTherapist = !!me.data?.therapist?.is_active;
  const schedule = useMySchedule(start, spanDays(start, end), isTherapist);
  const byDate = new Map<string, MyBooking[]>();
  for (const day of groupMySchedule(schedule.data ?? [], start)) byDate.set(day.date, day.bookings);
  return { isTherapist, byDate };
}

/**
 * Isi sel Kalender Absensi untuk terapis: "Spa · n treatment" bila hari itu
 * ada booking yang ditugaskan, menaut ke Tugas Terapis. Shift tetap tampil
 * sebagai shift; label Spa hanya untuk jadwal treatment.
 */
export function TherapistAttendanceDay({ date, start, end }: { date: string; start: string; end: string }) {
  const { isTherapist, byDate } = useMonthBookings(start, end);
  const bookings = (byDate.get(date) ?? []).filter((b) => wibDateOf(b.starts_at) === date);
  if (!isTherapist || bookings.length === 0) return null;
  const treatments = bookings.reduce((n, b) => n + b.items.length, 0);
  const first = bookings[0];
  return (
    <>
      <Link
        href="/dashboard/me/spa"
        onClick={(e) => e.stopPropagation()}
        title={bookings.map((b) => `${formatTime(b.starts_at)} ${b.customer_name}`).join(" · ")}
        className="hidden rounded-md border-l-2 border-pink-500 bg-pink-50 px-1.5 py-0.5 hover:bg-pink-100 sm:block"
      >
        <p className="truncate text-[10px] leading-tight font-semibold text-pink-700">Spa · {treatments} treatment</p>
        <p className="truncate text-[10px] leading-tight text-pink-500">
          {formatTime(first.starts_at)}
          {bookings.length > 1 ? ` +${bookings.length - 1} booking` : ` ${first.customer_name}`}
        </p>
      </Link>
      <span className="h-1.5 w-1.5 rounded-full bg-pink-500 sm:hidden" aria-label={`${treatments} treatment spa`} />
    </>
  );
}

/** Legenda "Spa (jadwal treatment)" — hanya untuk akun terapis. */
export function TherapistAttendanceLegend() {
  const me = useSpaMe();
  if (!me.data?.therapist?.is_active) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full bg-pink-500" /> Spa (jadwal treatment)
    </span>
  );
}
