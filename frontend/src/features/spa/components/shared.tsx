"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatNumber, formatTime } from "@/lib/format";
import { bookingStatusBadge, itemStatusBadge, paymentStatusBadge } from "../rules";
import type { Outlet, Pagination } from "../types";

export { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
export { SELECT } from "@/features/gym/shared";

export const SPA_KICKER = "Spa";

/**
 * Ikon bantuan dengan teks bebas — tampilan sama dengan HelpHint, tetapi
 * teksnya dari modul Spa (HelpHint hanya membaca registri help-content).
 */
export function SpaHint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Bantuan"
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-brand-text",
              className
            )}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[20rem]">{text}</TooltipContent>
    </Tooltip>
  );
}

export function BookingStatusBadge({ status }: { status: string }) {
  const b = bookingStatusBadge(status);
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

export function ItemStatusBadge({ status }: { status: string }) {
  const b = itemStatusBadge(status);
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const b = paymentStatusBadge(status);
  return (
    <Badge variant={b.variant} title="Status pembayaran">
      {b.label}
    </Badge>
  );
}

/** "10.00–11.30" (WIB). */
export function TimeRange({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatTime(start)}–{formatTime(end)}
    </span>
  );
}

/** Pilihan outlet; `outlets` biasanya hasil GET /api/spa/outlets. */
export function OutletSelect({
  outlets,
  value,
  onChange,
  className,
  allLabel,
  onlyConfigured = true,
  required,
  ariaLabel = "Outlet",
}: {
  outlets: Outlet[];
  value: string;
  onChange: (value: string) => void;
  className: string;
  /** Tampilkan opsi kosong dengan label ini (mis. "Semua outlet"). */
  allLabel?: string;
  onlyConfigured?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  const list = onlyConfigured ? outlets.filter((o) => o.configured) : outlets;
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      required={required}
    >
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {list.map((o) => (
        <option key={o.branch_id} value={o.branch_id}>
          {o.branch_name}
          {o.configured && !o.is_active ? " (nonaktif)" : ""}
        </option>
      ))}
    </select>
  );
}

export function Pager({
  pagination,
  onPage,
  disabled,
}: {
  pagination: Pagination | undefined;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  if (!pagination || pagination.totalPages <= 1) {
    return pagination ? (
      <p className="px-5 py-3 text-xs text-muted-foreground">{formatNumber(pagination.total)} booking</p>
    ) : null;
  }
  const { page, totalPages, total } = pagination;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
      <span>
        Halaman {page} dari {totalPages} · {formatNumber(total)} booking
      </span>
      <div className="flex gap-1">
        <Button size="icon-sm" variant="outline" aria-label="Sebelumnya" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Berikutnya"
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Blok kecil "label: isi" untuk ringkasan detail. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

/** Pesan galat validasi form. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
