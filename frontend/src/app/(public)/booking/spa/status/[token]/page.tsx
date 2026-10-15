import { PublicSpaBookingStatus } from "@/features/spa/components/public-booking-status";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata = {
  title: "Status booking — Paddy",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ bayar?: string | string[] }>;
}) {
  const [{ token }, { bayar }] = await Promise.all([params, searchParams]);
  // ?bayar= : "simulasi"/"gagal" untuk pembayaran penuh, "dp-simulasi"/"dp-gagal" untuk DP.
  const notice = typeof bayar === "string" && /^(dp-)?(simulasi|gagal)$/.test(bayar) ? bayar : undefined;
  return (
    <SiteLayout>
      <PublicSpaBookingStatus token={token} notice={notice} />
    </SiteLayout>
  );
}
