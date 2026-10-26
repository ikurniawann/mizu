import { requireIamPage } from "@/lib/auth/require-user";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { SpaTherapistsPage } from "@/features/spa";

export const metadata = { title: "Terapis Spa" };

export default async function Page() {
  const user = await requireIamPage(IAM.spaTherapists);
  const canViewCommission = await userHasIamAction(user.id, user.role, ["spa.commission-settings"], "read");
  return <SpaTherapistsPage canViewCommission={canViewCommission} />;
}
