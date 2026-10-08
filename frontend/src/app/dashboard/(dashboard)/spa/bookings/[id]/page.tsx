import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaBookingDetailPage } from "@/features/spa";

export const metadata = { title: "Detail Booking Spa" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireIamPage(IAM.spaBookings);
  const { id } = await params;
  return <SpaBookingDetailPage id={id} />;
}
