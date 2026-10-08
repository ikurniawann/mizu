import { PublicSpaBookingWizard } from "@/features/spa/components/public-booking-wizard";

export const metadata = {
  title: "Booking Spa — Mizu",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ outlet?: string; treatment?: string }> }) {
  const { outlet, treatment } = await searchParams;
  return <PublicSpaBookingWizard initialOutletSlug={outlet} initialTreatmentId={treatment} />;
}
