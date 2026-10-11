import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";

export default async function Page() {
  const user = await requireUser();
  if (await userHasIamAction(user.id, user.role, IAM.spaRushHour, "read")) redirect("/dashboard/spa/report/rush-hour");
  if (await userHasIamAction(user.id, user.role, IAM.spaTrend, "read")) redirect("/dashboard/spa/report/trend");
  if (await userHasIamAction(user.id, user.role, IAM.spaRating, "read")) redirect("/dashboard/spa/report/rating");
  redirect("/dashboard");
}
