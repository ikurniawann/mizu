import { HomePage } from "@/features/site/components/home-page";
import { fetchArticles, fetchBranches, fetchContent, fetchEvents, fetchSpaOutlets, fetchSpaTreatments } from "@/features/site/lib/public-api";
import { SiteLayout } from "@/features/site/site-layout";

export const dynamic = "force-dynamic";

/**
 * The public Mizu home for everyone, signed in or not. Customers must never
 * land on the staff desktop from here; staff open it at /os (OS_PATH), which
 * is also where login sends them.
 */
export default async function HomeRoute() {
  const [home, guide, social, branches, outlets, articles, events] = await Promise.all([
    fetchContent("home"), fetchContent("training"), fetchContent("social"), fetchBranches(), fetchSpaOutlets(), fetchArticles(), fetchEvents(),
  ]);
  // The treatment teaser shows the first outlet's menu and prices.
  const outlet = outlets.ok ? (outlets.data[0] ?? null) : null;
  const treatments = outlet ? await fetchSpaTreatments(outlet.branch_id) : null;
  const now = new Date();
  const upcomingEvents = events.filter((event) => new Date(event.starts_at).getTime() >= now.getTime()).slice(0, 1);
  return (
    <SiteLayout>
      <HomePage
        home={home}
        guide={guide}
        social={social}
        branches={branches}
        outlet={outlet}
        treatments={treatments?.ok ? treatments.data : []}
        articles={articles.slice(0, 3 - upcomingEvents.length)}
        events={upcomingEvents}
      />
    </SiteLayout>
  );
}
