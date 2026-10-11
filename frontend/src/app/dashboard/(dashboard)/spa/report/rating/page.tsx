import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { SpaRatingPage } from "@/features/report";

export const metadata = { title: "Spa Report · Rating" };

export default async function Page() {
  const user = await requireIamPage(IAM.spaRating);
  if (!await userHasIamAction(user.id, user.role, IAM.spaRating, "read")) redirect("/dashboard");
  return <SpaRatingPage />;
}
