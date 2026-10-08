import { PublicSpaBookingWizard } from "@/features/spa/components/public-booking-wizard";

export const metadata = {
  title: "Booking Spa — Mizu",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PublicSpaBookingWizard />;
}
