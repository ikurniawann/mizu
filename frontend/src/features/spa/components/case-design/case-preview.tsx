/* eslint-disable @next/next/no-img-element -- gambar katalog statis (WebP kecil) di public/experience */
import { cn } from "@/lib/utils";
import { CASE_FRAME, stickerSpots, type CaseDesign } from "../../experience";

const PLACEHOLDER_BG = "/experience/backgrounds/transparant-background.webp";

// Posisi gambar mockup supaya kotak pratinjau pas dengan badan HP (bukan bayangan & ruang kosong).
const FRAME_STYLE = {
  width: `${(CASE_FRAME.imageWidth / CASE_FRAME.width) * 100}%`,
  left: `${(-CASE_FRAME.left / CASE_FRAME.width) * 100}%`,
  top: `${(-CASE_FRAME.top / CASE_FRAME.height) * 100}%`,
  maxWidth: "none",
} as const;

/**
 * Pratinjau live custom case: mockup background + stiker di punggung case + nama.
 * Nama memakai font tampilan cadangan (file font cetak ada di workshop); nama font
 * yang akan dicetak crew ditampilkan terpisah oleh pemanggil.
 */
export function CasePreview({
  design,
  className,
  showEmptySlots = false,
  activeSlot = null,
  onSlot,
  label,
}: {
  /** Desain yang sudah di-resolve (punya `image` per stiker & `background_image`). */
  design: Pick<CaseDesign, "stickers" | "background_image" | "name" | "background_name">;
  className?: string;
  /** Tampilkan slot kosong bernomor (saat mendesain). */
  showEmptySlots?: boolean;
  activeSlot?: number | null;
  onSlot?: (slot: number) => void;
  label?: string;
}) {
  const spots = stickerSpots(design.stickers.length);
  const bg = design.background_image || PLACEHOLDER_BG;
  return (
    <div
      role="img"
      aria-label={label ?? `Pratinjau case${design.background_name ? ` ${design.background_name}` : ""}`}
      className={cn("relative aspect-[199/394] select-none [container-type:inline-size]", className)}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[16%/8%] drop-shadow-[0_14px_18px_rgb(30_20_25/0.28)]">
        <img
          src={bg}
          alt=""
          draggable={false}
          className={cn("absolute h-auto transition-opacity", !design.background_image && "opacity-60")}
          style={FRAME_STYLE}
        />
      </div>
      {design.stickers.map((s, i) => {
        const spot = spots[i];
        if (!spot) return null;
        const style = {
          left: `${spot.x}%`,
          top: `${spot.y}%`,
          width: `${spot.size}%`,
          transform: `translate(-50%, -50%) rotate(${spot.rotate}deg)`,
        };
        if (s.image) {
          const sticker = (
            <img
              src={s.image}
              alt={s.name ?? ""}
              draggable={false}
              className="aspect-square h-auto w-full object-contain drop-shadow-[0_2px_2px_rgb(0_0_0/0.25)]"
            />
          );
          return onSlot ? (
            <button
              key={i}
              type="button"
              onClick={() => onSlot(i)}
              aria-label={`Gambar ${i + 1}: ${s.name ?? ""}`}
              className={cn(
                "absolute rounded-full transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                activeSlot === i && "outline-2 outline-offset-2 outline-white/90 outline-dashed"
              )}
              style={style}
            >
              {sticker}
            </button>
          ) : (
            <span key={i} className="absolute" style={style}>
              {sticker}
            </span>
          );
        }
        if (!showEmptySlots) return null;
        return (
          <button
            key={i}
            type="button"
            disabled={!onSlot}
            onClick={() => onSlot?.(i)}
            aria-label={`Gambar ${i + 1} belum dipilih`}
            className={cn(
              "absolute flex aspect-square items-center justify-center rounded-full border-2 border-dashed bg-white/55 font-display font-bold text-ink backdrop-blur-[1px] transition",
              activeSlot === i ? "border-accent-strong text-accent-strong" : "border-white/90"
            )}
            style={{ ...style, width: `${spot.size * 0.7}%`, fontSize: "9cqw" }}
          >
            {i + 1}
          </button>
        );
      })}
      {design.name ? (
        <span
          className="pointer-events-none absolute inset-x-[6%] top-[84%] -translate-y-1/2 truncate text-center font-display leading-none font-black tracking-wide text-white [paint-order:stroke_fill]"
          style={{ fontSize: design.name.length > 8 ? "11cqw" : "14cqw", WebkitTextStroke: "0.9cqw #2a1024", textShadow: "0 1.2cqw 0 rgb(42 16 36 / 0.35)" }}
        >
          {design.name}
        </span>
      ) : null}
    </div>
  );
}

/** Pratinjau mini (kartu Book Order, daftar, ringkasan). */
export function CaseThumb({ design, className }: { design: CaseDesign; className?: string }) {
  return <CasePreview design={design} className={cn("w-10 shrink-0", className)} label={`Desain ${design.model}`} />;
}

/** Potongan badan HP dari mockup background (untuk tile pilihan). */
export function BackgroundSwatch({ image, className }: { image: string; className?: string }) {
  return (
    <span className={cn("relative block aspect-[199/394] w-full max-w-16 overflow-hidden rounded-[16%/8%]", className)}>
      <img src={image} alt="" loading="lazy" className="absolute h-auto" style={FRAME_STYLE} />
    </span>
  );
}
