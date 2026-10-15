import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { SpaRushHourPage } from "@/features/spa";

export const metadata = { title: "Experience Report · Rush Hour" };

export default async function Page() {
  const user = await requireIamPage(IAM.spaRushHour);
  if (!await userHasIamAction(user.id, user.role, IAM.spaRushHour, "read")) redirect("/dashboard");
  return <SpaRushHourPage />;
}
