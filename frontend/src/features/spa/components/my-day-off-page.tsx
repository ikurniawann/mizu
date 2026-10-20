"use client";

import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useSpaMe } from "../queries";
import { MyDayOffCard } from "./my-day-off-card";

/** Area Karyawan → Jadwal Libur: pengajuan mandiri khusus terapis. */
export function MyDayOffPage() {
  const me = useSpaMe();

  if (me.isLoading) return <Loader2 className="mx-auto my-20 size-8 animate-spin text-muted-foreground" />;
  if (me.error) return <p className="py-20 text-center text-sm text-danger">{me.error.message}</p>;
  if (!me.data?.therapist?.is_active) {
    return <p className="py-20 text-center text-sm text-muted-foreground">Akun Anda belum terdaftar sebagai terapis aktif.</p>;
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <PageHeader kicker="Area Karyawan" title="Jadwal Libur" description="Ajukan dan pantau hari libur terapis Anda." />
      <MyDayOffCard />
    </div>
  );
}
