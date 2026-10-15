"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, Hourglass, Sparkles, Wallet } from "lucide-react";
import { todayWib } from "@/lib/dates";
import { formatRupiah, formatTime } from "@/lib/format";
import { dayLabel, groupMySchedule, isNewAssignment } from "../my-schedule";
import { useMySchedule, useMySummary, useSpaMe } from "../queries";
import { currentMonthWib, wibDateOf } from "../time";

const MONTH_NAME = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/**
 * Kartu "Terapis" di Beranda Karyawan (/dashboard/me): booking berikutnya dan
 * komisi bulan ini (cair · menunggu pembayaran · perkiraan), dengan tautan ke
 * Tugas Terapis. Tidak tampil untuk karyawan yang bukan terapis.
 */
export function TherapistBerandaCard() {
  const me = useSpaMe();
  const isTherapist = !!me.data?.therapist?.is_active;
  const today = todayWib();
  const [month] = useState(() => currentMonthWib());
  const [now] = useState(() => new Date());
  const schedule = useMySchedule(today, 14, isTherapist);
  const summary = useMySummary(month, isTherapist);

  if (!isTherapist) return null;

  const bookings = groupMySchedule(schedule.data ?? [], today).flatMap((d) => d.bookings);
  const ahead = bookings.filter((b) => b.booking_status !== "completed" && new Date(b.ends_at).getTime() > now.getTime());
  const next = ahead[0];
  const todayCount = bookings.filter((b) => wibDateOf(b.starts_at) === today && b.booking_status !== "completed").length;
  const fresh = ahead.filter((b) => isNewAssignment(b, now)).length;
  const monthLabel = MONTH_NAME[Number(month.slice(5, 7)) - 1] ?? "";
  const s = summary.data;

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Sparkles className="h-5 w-5 text-pink-600" /> Crew Experience
          {fresh > 0 && (
            <span className="rounded-full bg-pink-100 px-2 py-0.5 text-xs font-semibold text-pink-700">{fresh} booking baru</span>
          )}
        </h2>
        <Link href="/dashboard/me/spa" className="flex items-center gap-1 text-sm font-semibold text-pink-700 hover:underline">
          Jadwal & tugas <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Link href="/dashboard/me/spa" className="block rounded-xl bg-gray-50 p-4 transition hover:bg-gray-100">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <CalendarClock className="h-4 w-4" /> Booking berikutnya
          </p>
          {schedule.isLoading ? (
            <p className="mt-2 text-sm text-gray-400">Memuat…</p>
          ) : next ? (
            <>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {dayLabel(wibDateOf(next.starts_at), today)} · {formatTime(next.starts_at)}
              </p>
              <p className="truncate text-sm text-gray-700">
                {next.customer_name} · {next.items.map((i) => i.treatment_name).join(", ")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Hari ini {todayCount} booking · {ahead.length} booking dalam 14 hari
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Belum ada booking untukmu 14 hari ke depan.</p>
          )}
        </Link>

        <Link href="/dashboard/me/spa#komisi" className="block rounded-xl bg-emerald-50/60 p-4 transition hover:bg-emerald-50">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <Wallet className="h-4 w-4" /> Komisi {monthLabel} · sudah cair
          </p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900 tabular-nums">{s ? formatRupiah(s.earned_idr) : "…"}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <p className="text-gray-600">
              <span className="flex items-center gap-1 font-semibold text-gray-700">
                <Hourglass className="h-3.5 w-3.5" /> Menunggu bayar
              </span>
              {s ? formatRupiah(s.pending_idr) : "…"}
            </p>
            <p className="text-gray-600">
              <span className="flex items-center gap-1 font-semibold text-gray-700">
                <CalendarClock className="h-3.5 w-3.5" /> Perkiraan jadwal
              </span>
              {s ? formatRupiah(s.upcoming_idr) : "…"}
            </p>
          </div>
        </Link>
      </div>
    </section>
  );
}
