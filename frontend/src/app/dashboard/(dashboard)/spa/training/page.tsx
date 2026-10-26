import { redirect } from "next/navigation";
import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { SpaTrainingPage } from "@/features/spa/components/training-page";

export const metadata = { title: "Training Spa" };

export default async function Page() {
  const prefixes = ["spa.training"];
  const user = await requireIamPage(prefixes);
  const [read, create, update] = await Promise.all(["read", "create", "update"].map((action) => userHasIamAction(user.id, user.role, prefixes, action)));
  if (!read) redirect("/dashboard");
  return <SpaTrainingPage canCreate={create} canUpdate={update} />;
}
