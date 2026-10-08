import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** The public spa booking wizard; every primary call to action lands here. */
export const BOOKING_HREF = "/booking/spa";

/** A button link to the booking wizard. */
export function BookingButton({ children = "Booking", icon = true, ...props }: Omit<ButtonProps, "asChild"> & { children?: ReactNode; icon?: boolean }) {
  return (
    <Button asChild {...props}>
      <Link href={BOOKING_HREF}>
        {icon ? <CalendarCheck /> : null}
        {children}
      </Link>
    </Button>
  );
}
