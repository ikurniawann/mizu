import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { SpaTrendPage } from "@/features/report";

export const metadata = { title: "Experience Report · Trend" };

export default async function Page() {
  const user = await requireIamPage(IAM.spaTrend);
  if (!await userHasIamAction(user.id, user.role, IAM.spaTrend, "read")) redirect("/dashboard");
  return <SpaTrendPage />;
}
