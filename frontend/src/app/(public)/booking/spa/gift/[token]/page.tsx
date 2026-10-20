import { PublicGiftStatus } from "@/features/spa/components/public-gift-status";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata = {
  title: "Gift voucher — Mizu",
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
  return (
    <SiteLayout>
      <PublicGiftStatus token={token} simulate={bayar === "simulasi"} />
    </SiteLayout>
  );
}
