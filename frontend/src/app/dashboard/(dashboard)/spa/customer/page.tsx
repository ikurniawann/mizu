import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaCustomersPage } from "@/features/spa";

export const metadata = { title: "Customer Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaCustomer);
  return <SpaCustomersPage />;
}
