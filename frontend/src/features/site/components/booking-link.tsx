import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** The public spa booking wizard; every primary call to action lands here. */
export const BOOKING_HREF = "/booking/spa";

/** Booking link with the outlet (and treatment) already chosen. */
export function bookingHref(branchId?: string | null, treatmentId?: string | null): string {
  const params = new URLSearchParams();
  if (branchId) params.set("outlet", branchId);
  if (branchId && treatmentId) params.set("treatment", treatmentId);
  const query = params.toString();
  return query ? `${BOOKING_HREF}?${query}` : BOOKING_HREF;
}

/** A button link to the booking wizard. */
export function BookingButton({
  children = "Booking",
  icon = true,
  href = BOOKING_HREF,
  ...props
}: Omit<ButtonProps, "asChild"> & { children?: ReactNode; icon?: boolean; href?: string }) {
  return (
    <Button asChild {...props}>
      <Link href={href}>
        {icon ? <CalendarCheck /> : null}
        {children}
      </Link>
    </Button>
  );
}
