"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Menu, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BOOKING_HREF } from "../components/booking-link";
import { useCartCount } from "../lib/cart-count";
import { useSitePanels } from "./panels";

/** The main navigation of the public site. */
export const SITE_NAV = [
  { href: "/", label: "Beranda" },
  { href: "/treatments", label: "Treatment" },
  { href: "/locations", label: "Lokasi" },
  { href: "/space", label: "Suasana" },
  { href: "/brand", label: "Tentang" },
  { href: "/news", label: "Berita" },
  { href: "/contact", label: "Kontak" },
] as const;

/** Secondary links in the top bar and the footer. */
export const SECONDARY_NAV = [{ href: "/career", label: "Karier" }] as const;

function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="Mizu, ke beranda">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wordmark-black.png" alt="" className="h-6 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wordmark-white.png" alt="" className="hidden h-6 w-auto dark:block" />
    </Link>
  );
}

function NavLinks({ items, current, onNavigate, className }: {
  items: readonly { href: string; label: string }[];
  current: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <>
      {items.map((item) => {
        const active = item.href === "/" ? current === "/" : current === item.href || current.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 transition-colors hover:bg-surface-2",
              active ? "font-semibold text-foreground" : "text-body",
              className,
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function SiteHeader({ memberLinked }: { memberLinked: boolean }) {
  const pathname = usePathname() ?? "/";
  const panels = useSitePanels();
  const cartCount = useCartCount();
  const [menuOpen, setMenuOpen] = useState(false);

  // The shop is not part of the spa site; the cart stays reachable only
  // for a visitor who still has items in it.
  const cartButton = cartCount > 0 ? (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Keranjang, ${cartCount} item`}
      onClick={() => panels.open("cart")}
      className="relative"
    >
      <ShoppingBag />
      <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-strong px-1 text-[11px] font-bold text-accent-foreground">
        {cartCount > 99 ? "99+" : cartCount}
      </span>
    </Button>
  ) : null;

  return (
    <header className="sticky top-0 z-30 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="hidden border-b border-border/60 md:block">
        <div className="mx-auto flex h-9 max-w-6xl items-center justify-end gap-1 px-4 text-xs lg:px-6">
          <p className="mr-auto text-muted-foreground">Rest. Relax. Rejuvenate. · Bandung</p>
          <NavLinks items={SECONDARY_NAV} current={pathname} className="px-2.5 py-1" />
          {memberLinked ? (
            <Link href="/member" className="ml-2 rounded-full bg-ink px-3 py-1 font-semibold text-on-ink">
              Area Member
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 lg:px-6">
        <Wordmark />
        <nav aria-label="Navigasi utama" className="ml-4 hidden items-center gap-1 text-sm lg:flex">
          <NavLinks items={SITE_NAV} current={pathname} />
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {cartButton}
          <Button asChild>
            <Link href={BOOKING_HREF}>
              <CalendarCheck className="hidden sm:block" />
              Booking
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu" onClick={() => setMenuOpen(true)}>
            <Menu />
          </Button>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" showCloseButton={false} aria-describedby={undefined}>
          <SheetHeader className="flex-row items-center justify-between">
            <SheetTitle>Menu</SheetTitle>
            <Button variant="ghost" size="icon" aria-label="Tutup menu" onClick={() => setMenuOpen(false)}>
              <X />
            </Button>
          </SheetHeader>
          <nav aria-label="Navigasi" className="flex flex-col gap-1 px-2 text-base">
            <NavLinks items={SITE_NAV} current={pathname} onNavigate={() => setMenuOpen(false)} className="px-3 py-2.5" />
            <div className="my-2 h-px bg-border" />
            <NavLinks items={SECONDARY_NAV} current={pathname} onNavigate={() => setMenuOpen(false)} className="px-3 py-2.5 text-sm" />
            {memberLinked ? (
              <Link href="/member" onClick={() => setMenuOpen(false)} className="px-3 py-2.5 text-sm font-semibold text-forest">
                Area Member
              </Link>
            ) : null}
          </nav>
          <div className="mt-auto flex flex-col gap-2 p-4">
            <Button asChild size="lg">
              <Link href={BOOKING_HREF} onClick={() => setMenuOpen(false)}>
                <CalendarCheck />
                Booking treatment
              </Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">Pembayaran dilakukan di outlet.</p>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
