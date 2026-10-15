"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import {
  MONTH_LONG_ID,
  computePeriod,
  cutoffDescription,
  periodKeyFor,
  periodRangeLabel,
  shortDateId,
  todayWib,
} from "@/lib/hris/attendance-period";
import { useAttendanceSettings, useAttendanceSettingsPreview } from "../queries";
import { useSaveAttendanceSettings } from "../mutations";

const CUTOFF_OPTIONS = [
  { value: "0", label: "Akhir bulan (bulan kalender)" },
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Tanggal ${i + 1}` })),
];

/**
 * Pengaturan periode absensi: tanggal cut-off dan jarak closing otomatis,
 * dengan pratinjau periode berjalan & berikutnya. Periode yang sudah pernah
 * di-closing tidak ikut berubah.
 */
export function AttendancePeriodSettingsCard() {
  const query = useAttendanceSettings();
  const save = useSaveAttendanceSettings();
  const [edits, setEdits] = useState<{ cutoff?: string; offset?: string }>({});
  const data = query.data;
  const stored = data?.settings;
  const cutoff = edits.cutoff ?? String(stored?.cutoff_day ?? 0);
  const offset = edits.offset ?? String(stored?.closing_offset_days ?? 3);
  const dirty =
    stored !== undefined && (cutoff !== String(stored.cutoff_day) || offset !== String(stored.closing_offset_days));
  const offsetNum = Number(offset);
  const offsetValid = Number.isInteger(offsetNum) && offsetNum >= 0 && offsetNum <= 31;

  const serverPreview = useAttendanceSettingsPreview(Number(cutoff), offsetNum, dirty && offsetValid).data;
  const today = data?.today ?? todayWib();
  const key = periodKeyFor(Number(cutoff), today);
  const preview = computePeriod(Number(cutoff), offsetNum || 0, key.year, key.month);
  const nextKey = key.month === 12 ? { year: key.year + 1, month: 1 } : { year: key.year, month: key.month + 1 };
  const next = computePeriod(Number(cutoff), offsetNum || 0, nextKey.year, nextKey.month);

  function submit() {
    save.mutate(
      { cutoffDay: Number(cutoff), offsetDays: offsetNum },
      {
        onSuccess: () => {
          setEdits({});
          toast.success("Pengaturan periode absensi tersimpan");
        },
        onError: (err) => toast.error(err.message || "Gagal menyimpan pengaturan"),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-5 w-5 text-pink-600" />
          Pengaturan Periode Absensi
        </CardTitle>
        <p className="text-sm text-gray-500">
          Cut-off menentukan rentang absensi yang dibaca payroll tiap bulan. Sebelum tanggal closing, HRD masih bisa
          menyesuaikan absensi; setelahnya periode terkunci otomatis.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Tanggal cut-off</label>
                <Select
                  value={cutoff}
                  onValueChange={(v) => setEdits((e) => ({ ...e, cutoff: v ?? "0" }))}
                  disabled={!data?.can_manage}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUTOFF_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-gray-500">{cutoffDescription(Number(cutoff))}</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="closing-offset">
                  Closing otomatis (hari setelah akhir periode)
                </label>
                <Input
                  id="closing-offset"
                  type="number"
                  min={0}
                  max={31}
                  value={offset}
                  disabled={!data?.can_manage}
                  onChange={(e) => setEdits((ed) => ({ ...ed, offset: e.target.value }))}
                />
                {!offsetValid && <p className="mt-1 text-xs text-red-600">Isi 0–31 hari.</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Periode berjalan</p>
                {!dirty && data?.current_period ? (
                  <>
                    <p className="font-medium text-gray-900">
                      {data.current_period.name}: {data.current_period.label}
                    </p>
                    <p className="text-xs text-gray-500">
                      {data.current_period.status === "closed"
                        ? "Sudah di-closing"
                        : `Closing otomatis ${shortDateId(data.current_period.closing_date)}`}
                    </p>
                  </>
                ) : serverPreview ? (
                  <>
                    <p className="font-medium text-gray-900">
                      {serverPreview.current.name}: {serverPreview.current.label}
                    </p>
                    <p className="text-xs text-gray-500">
                      {serverPreview.current.frozen
                        ? "Pernah di-closing — rentang tetap"
                        : `Closing otomatis ${shortDateId(serverPreview.current.closing_date)}`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-gray-900">
                      {MONTH_LONG_ID[preview.month - 1]} {preview.year}: {periodRangeLabel(preview.start, preview.end)}
                    </p>
                    <p className="text-xs text-gray-500">Closing otomatis {shortDateId(preview.closing)}</p>
                  </>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Periode berikutnya</p>
                {dirty && serverPreview ? (
                  <>
                    <p className="font-medium text-gray-900">
                      {serverPreview.next.name}: {serverPreview.next.label}
                    </p>
                    <p className="text-xs text-gray-500">
                      Closing otomatis {shortDateId(serverPreview.next.closing_date)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-gray-900">
                      {MONTH_LONG_ID[next.month - 1]} {next.year}: {periodRangeLabel(next.start, next.end)}
                    </p>
                    <p className="text-xs text-gray-500">Closing otomatis {shortDateId(next.closing)}</p>
                  </>
                )}
              </div>
              {dirty && data?.current_period && (
                <p className="text-xs text-amber-700 sm:col-span-2">
                  Tersimpan saat ini: {data.current_period.name} {data.current_period.label}. Periode yang sudah pernah
                  di-closing tidak berubah; periode setelahnya menyambung tepat sesudahnya.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-400">
                {stored?.updated_by_name
                  ? `Terakhir diubah ${stored.updated_by_name} · ${formatDateTime(stored.updated_at)}`
                  : "Belum pernah diubah (default: bulan kalender, closing 3 hari)"}
              </p>
              {data?.can_manage && (
                <Button
                  onClick={submit}
                  disabled={!dirty || !offsetValid || save.isPending}
                  className="gap-2 bg-pink-600 text-white hover:bg-pink-700"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Simpan pengaturan
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
