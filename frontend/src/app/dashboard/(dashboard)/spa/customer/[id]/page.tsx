import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaCustomerDetailPage } from "@/features/spa";

export const metadata = { title: "Detail Customer Spa" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireIamPage(IAM.spaCustomer);
  const { id } = await params;
  return <SpaCustomerDetailPage id={id} />;
}
