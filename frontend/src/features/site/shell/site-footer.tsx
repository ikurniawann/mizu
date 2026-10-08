"use client";

import Link from "next/link";
import { Camera, Mail, MapPin, MessageCircle, Music2, Play } from "lucide-react";
import { BOOKING_HREF } from "../components/booking-link";
import type { BranchSummary, SocialContent } from "../types";
import { SECONDARY_NAV, SITE_NAV } from "./site-header";

function Outlets({ branches }: { branches: BranchSummary[] }) {
  if (branches.length === 0) return null;
  return (
    <ul className="space-y-3 text-sm">
      {branches.map((b) => (
        <li key={b.slug} className="flex gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <Link href={`/locations/${b.slug}`} className="font-semibold text-foreground hover:underline">
              {b.name}
            </Link>
            {b.address || b.city ? <span className="block text-body">{[b.address, b.city].filter(Boolean).join(", ")}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SocialLinks({ social }: { social: SocialContent }) {
  const items = [
    { href: social.instagram, label: "Instagram", Icon: Camera },
    { href: social.tiktok, label: "TikTok", Icon: Music2 },
    { href: social.youtube, label: "YouTube", Icon: Play },
    { href: social.whatsapp ? `https://wa.me/${social.whatsapp.replace(/\D/g, "")}` : "", label: "WhatsApp", Icon: MessageCircle },
    { href: social.email ? `mailto:${social.email}` : "", label: "Email", Icon: Mail },
  ].filter((item) => item.href);
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ href, label, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
            aria-label={label}
            className="flex size-10 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors hover:bg-surface-2"
          >
            <Icon className="size-4" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter({ branches, social }: { branches: BranchSummary[]; social: SocialContent }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 bg-surface">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-12 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] lg:px-6">
        <div className="space-y-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lockup-black.png" alt="Mizu Family Massage & Reflexology" className="h-8 w-auto max-w-full dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lockup-white.png" alt="Mizu Family Massage & Reflexology" className="hidden h-8 w-auto max-w-full dark:block" />
          <p className="max-w-sm text-sm text-body">
            Family massage & reflexology di Bandung. Magical places to rest, relax and rejuvenate.
          </p>
          <Outlets branches={branches} />
          <SocialLinks social={social} />
        </div>
        <nav aria-label="Halaman" className="text-sm">
          <p className="mb-3 font-semibold text-foreground">Jelajahi</p>
          <ul className="space-y-2">
            {SITE_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-body hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Mizu" className="text-sm">
          <p className="mb-3 font-semibold text-foreground">Mizu</p>
          <ul className="space-y-2">
            <li>
              <Link href={BOOKING_HREF} className="font-semibold text-forest hover:underline dark:text-accent">
                Booking treatment
              </Link>
            </li>
            {SECONDARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-body hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/member" className="text-body hover:text-foreground">
                Area Member
              </Link>
            </li>
          </ul>
          <p className="mt-6 text-xs text-muted-foreground">Booking online, pembayaran di outlet.</p>
        </nav>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <p>© {year} Mizu Family Massage & Reflexology.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">
              Kebijakan Privasi
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Syarat & Ketentuan
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
