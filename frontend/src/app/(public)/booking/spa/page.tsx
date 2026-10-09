import type { Metadata } from "next";
import { PublicSpaBookingWizard } from "@/features/spa/components/public-booking-wizard";
import { parsePrefill } from "@/features/spa/public-booking";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  title: "Booking Treatment — Mizu",
  description: "Booking pijat, refleksi dan perawatan tubuh di Mizu Family Massage & Reflexology, Bandung. Pilih outlet, treatment dan jam; bayar di outlet.",
};

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const prefill = parsePrefill(await searchParams);
  return (
    <SiteLayout>
      <PublicSpaBookingWizard prefill={prefill} />
    </SiteLayout>
  );
}
