import { redirect } from "next/navigation";
import { SalesVsTargetPage } from "@/features/report";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";

export const metadata = { title: "Report · Sales vs Target" };

export default async function Page() {
  const user = await requireIamPage(IAM.reportSalesTarget);
  if (!await userHasIamAction(user.id, user.role, IAM.reportSalesTarget, "read")) redirect("/dashboard");
  const [create, update, remove] = await Promise.all(["create", "update", "delete"].map((action) => userHasIamAction(user.id, user.role, IAM.reportSalesTarget, action)));
  return <SalesVsTargetPage permissions={{ create, update, delete: remove }} />;
}
