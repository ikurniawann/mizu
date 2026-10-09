import { PublicSpaBookingStatus } from "@/features/spa/components/public-booking-status";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata = {
  title: "Status booking — Mizu",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <SiteLayout>
      <PublicSpaBookingStatus token={token} />
    </SiteLayout>
  );
}
