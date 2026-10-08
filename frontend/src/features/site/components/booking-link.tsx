import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** The public spa booking wizard; every primary call to action lands here. */
export const BOOKING_HREF = "/booking/spa";

export function bookingHref(options: { outlet?: string; treatment?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.outlet) params.set("outlet", options.outlet);
  if (options.treatment) params.set("treatment", options.treatment);
  return params.size ? `${BOOKING_HREF}?${params}` : BOOKING_HREF;
}

/** A button link to the booking wizard. */
export function BookingButton({ children = "Booking", icon = true, outlet, treatment, ...props }: Omit<ButtonProps, "asChild"> & { children?: ReactNode; icon?: boolean; outlet?: string; treatment?: string }) {
  return (
    <Button asChild {...props}>
      <Link href={bookingHref({ outlet, treatment })}>
        {icon ? <CalendarCheck /> : null}
        {children}
      </Link>
    </Button>
  );
}
