import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaBookingsPage } from "@/features/spa";

export const metadata = { title: "Booking Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaBookings);
  return <SpaBookingsPage />;
}
