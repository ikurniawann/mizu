import { HomePage } from "@/features/site/components/home-page";
import { fetchBranches, fetchContent, fetchSpaOutlets, fetchSpaTreatments } from "@/features/site/lib/public-api";
import { SiteLayout } from "@/features/site/site-layout";

export const dynamic = "force-dynamic";

/**
 * The public Mizu home for everyone, signed in or not. Customers must never
 * land on the staff desktop from here; staff open it at /os (OS_PATH), which
 * is also where login sends them.
 */
export default async function HomeRoute() {
  const [home, social, branches, outlets] = await Promise.all([
    fetchContent("home"), fetchContent("social"), fetchBranches(), fetchSpaOutlets(),
  ]);
  // The menu card and offers use the first outlet's menu and prices.
  const outlet = outlets.ok ? (outlets.data[0] ?? null) : null;
  const treatments = outlet ? await fetchSpaTreatments(outlet.branch_id) : null;
  return (
    <SiteLayout>
      <HomePage home={home} social={social} branches={branches} outlet={outlet} treatments={treatments?.ok ? treatments.data : []} />
    </SiteLayout>
  );
}
