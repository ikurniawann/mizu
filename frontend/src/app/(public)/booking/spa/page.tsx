import type { Metadata } from "next";
import { PublicSpaBookingWizard } from "@/features/spa/components/public-booking-wizard";
import { parsePrefill } from "@/features/spa/public-booking";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  title: "Booking Paddy Experience — Paddy",
  description: "Desain custom case HP kamu sendiri di Paddy Experience — tipe HP, stiker dari 16 tema, nama dan background — lalu pilih Paddy Store, jam, dan crew. Rp119.000, bayar di toko.",
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
