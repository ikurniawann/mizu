import { OsDesktopLoader } from "@/features/os-desktop/components/os-desktop-loader";
import { redirect } from "next/navigation";
import { HomePage } from "@/features/site/components/home-page";
import { fetchArticles, fetchBranches, fetchContent, fetchEvents, fetchSpaOutlets, fetchSpaTreatments } from "@/features/site/lib/public-api";
import { SiteLayout } from "@/features/site/site-layout";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyUser } from "@/lib/iam/get-user-menus";

export const dynamic = "force-dynamic";

/** Signed-in staff keep the OS desktop; visitors and members get the public home. */
export default async function HomeRoute() {
  const { user } = await getUser();

  if (!user) {
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
  // User ESS-only (per IAM) tidak punya desktop NüHabit OS → langsung ke Area Karyawan.
  if (await isEssOnlyUser(user.id, user.role)) {
    redirect("/dashboard/me");
  }

  return <OsDesktopLoader />;
}
