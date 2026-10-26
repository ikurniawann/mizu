import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { CommissionSettingsPage } from "@/features/spa/components/commission-settings-page";

export const metadata = { title: "Pengaturan Komisi" };
export default async function Page() {
  const prefixes = ["spa.commission-settings"];
  const user = await requireIamPage(prefixes);
  const [read, update] = await Promise.all(["read", "update"].map((action) => userHasIamAction(user.id, user.role, prefixes, action)));
  if (!read) redirect("/dashboard");
  return <CommissionSettingsPage canUpdate={update} />;
}
