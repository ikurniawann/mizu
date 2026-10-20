import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { SpaCustomerReportPage } from "@/features/report";

export const metadata = { title: "Spa Report · Customer" };

export default async function Page() {
  const user = await requireIamPage(IAM.spaCustomerReport);
  if (!await userHasIamAction(user.id, user.role, IAM.spaCustomerReport, "read")) redirect("/dashboard");
  return <SpaCustomerReportPage />;
}
