import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaBookOrderPage } from "@/features/spa";

export const metadata = { title: "Book Order Studio" };

export default async function Page() {
  await requireIamPage(IAM.spaBookings);
  return <SpaBookOrderPage />;
}
