import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaBookOrderPage } from "@/features/spa";

export const metadata = { title: "Book Order Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaBookings);
  return <SpaBookOrderPage />;
}
