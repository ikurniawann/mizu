import type { Metadata } from "next";
import { PublicBookingReschedule } from "@/features/spa/components/public-booking-reschedule";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  title: "Ubah jadwal booking — Mizu",
  description: "Pindahkan jadwal booking Mizu sendiri sampai 1 jam sebelum jadwal dengan kode booking dan nomor WhatsApp.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ kode?: string | string[] }> }) {
  const { kode } = await searchParams;
  const code = typeof kode === "string" && /^[\w\s-]{4,30}$/.test(kode) ? kode : "";
  return (
    <SiteLayout>
      <PublicBookingReschedule initialCode={code} />
    </SiteLayout>
  );
}
