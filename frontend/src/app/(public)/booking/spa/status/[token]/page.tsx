import { PublicSpaBookingStatus } from "@/features/spa/components/public-booking-status";

export const metadata = {
  title: "Status booking spa — Mizu",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicSpaBookingStatus token={token} />;
}
