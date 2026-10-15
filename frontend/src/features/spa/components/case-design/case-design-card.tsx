/* eslint-disable @next/next/no-img-element -- gambar katalog statis (WebP kecil) di public/experience */
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaseDesign } from "../../experience";
import { CasePreview } from "./case-preview";

/**
 * Ringkasan desain custom case: pratinjau kecil + rincian (HP, background, stiker,
 * nama & font). Dipakai di ringkasan booking, halaman status, dan detail booking staf.
 */
export function CaseDesignCard({
  design,
  className,
  size = "md",
  action,
}: {
  design: CaseDesign;
  className?: string;
  size?: "sm" | "md" | "lg";
  action?: React.ReactNode;
}) {
  const stickers = design.stickers.filter((s) => s.code);
  return (
    <div className={cn("flex gap-3", className)}>
      <div className="shrink-0 rounded-2xl bg-surface px-2.5 py-2">
        <CasePreview design={design} className={size === "sm" ? "w-12" : size === "lg" ? "w-24 sm:w-28" : "w-16"} label={`Desain case ${design.model}`} />
      </div>
      <dl className={cn("min-w-0 flex-1 space-y-1", size === "lg" ? "text-sm" : "text-xs")}>
        <div>
          <dt className="sr-only">Tipe HP</dt>
          <dd className="font-semibold text-foreground">
            {design.model}
            {design.brand_name ? <span className="font-normal text-muted-foreground"> · {design.brand_name}</span> : null}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Background</dt>
          <dd className="font-medium text-foreground">{design.background_name ?? design.background}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {stickers.length} stiker{design.layout_name ? ` · ${design.layout_name}` : ""}
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {stickers.map((s, i) => (
              <span key={`${s.code}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pr-2 pl-0.5 font-medium text-foreground">
                {s.image ? <img src={s.image} alt="" className="size-5 object-contain" /> : null}
                {s.name ?? s.code}
              </span>
            ))}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Nama</dt>
          <dd className="font-medium text-foreground">
            {design.name ? (
              <>
                “{design.name}” <span className="text-muted-foreground">· font {design.font_name ?? design.font}</span>
              </>
            ) : (
              "Tanpa nama"
            )}
          </dd>
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </dl>
    </div>
  );
}

/** Lencana kecil status desain untuk kartu/daftar staf. */
export function CaseDesignBadge({ design, className }: { design?: CaseDesign | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        design ? "bg-accent-soft text-foreground" : "bg-warning-soft text-warning",
        className
      )}
    >
      <Palette className="size-3" />
      {design ? "Desain siap" : "Belum ada desain"}
    </span>
  );
}
