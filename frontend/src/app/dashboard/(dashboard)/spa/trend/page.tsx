import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";

export default async function Page() {
  await requireIamPage(IAM.spaTrend);
  redirect("/dashboard/spa/report/trend");
}
