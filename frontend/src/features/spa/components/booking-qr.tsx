"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingQrFileName } from "../public-booking";

const QR_PX = 640;

/**
 * QR kode booking yang bisa disimpan pelanggan: di layar tampil QR, tombol
 * "Simpan QR" membuat gambar PNG bermerek (QR + kode + outlet + jadwal) lalu
 * mengunduhnya, atau membuka lembar bagikan di ponsel.
 */
export function BookingQr({ code, outlet, when }: { code: string; outlet: string; when: string }) {
  const source = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");

  const save = async () => {
    const qr = source.current?.querySelector("canvas");
    if (!qr) return;
    setState("busy");
    try {
      const blob = await composeTicket(qr, code, outlet, when);
      const file = new File([blob], bookingQrFileName(code), { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (window.matchMedia("(pointer: coarse)").matches && nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Booking Mizu ${code}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setState("saved");
    } catch {
      // Dibatalkan dari lembar bagikan, atau peramban menolak: biarkan dicoba lagi.
      setState("idle");
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 rounded-card bg-card p-6 text-center shadow-card sm:flex-row sm:text-left">
      <div ref={source} className="shrink-0 rounded-2xl bg-white p-3 shadow-card">
        <QRCodeCanvas
          value={code}
          size={QR_PX}
          marginSize={1}
          level="M"
          fgColor="#231a14"
          aria-label={`QR kode booking ${code}`}
          style={{ width: 160, height: 160 }}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <p className="font-display text-xl font-semibold">QR booking</p>
          <p className="text-sm text-body">
            Tunjukkan QR ini ke resepsionis saat tiba. Simpan ke galeri supaya tetap bisa dibuka tanpa internet.
          </p>
        </div>
        <Button size="lg" variant="ink" onClick={() => void save()} disabled={state === "busy"}>
          {state === "busy" ? <Loader2 className="animate-spin" /> : state === "saved" ? <Check /> : <Download />}
          {state === "saved" ? "QR tersimpan" : "Simpan QR"}
        </Button>
      </div>
    </div>
  );
}

/** Gambar tiket 720×1000: latar krem, kartu putih, QR, kode, outlet dan jadwal. */
async function composeTicket(qr: HTMLCanvasElement, code: string, outlet: string, when: string): Promise<Blob> {
  const W = 720;
  const H = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  ctx.fillStyle = "#231a14";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fbf7f0";
  roundRect(ctx, 40, 40, W - 80, H - 80, 36);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#231a14";
  ctx.font = "600 44px Georgia, 'Playfair Display', serif";
  ctx.fillText("M I Z U", W / 2, 128);
  ctx.fillStyle = "#8a6f52";
  ctx.font = "500 20px system-ui, sans-serif";
  ctx.fillText("Family Massage & Reflexology", W / 2, 162);

  const size = 440;
  ctx.drawImage(qr, (W - size) / 2, 200, size, size);

  ctx.fillStyle = "#231a14";
  ctx.font = "700 46px ui-monospace, 'JetBrains Mono', monospace";
  ctx.fillText(code, W / 2, 712);
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.fillText(outlet, W / 2, 780);
  ctx.fillStyle = "#5c4a3b";
  ctx.font = "400 24px system-ui, sans-serif";
  wrapCentered(ctx, when, W / 2, 822, W - 160, 32);
  ctx.fillStyle = "#8a6f52";
  ctx.font = "400 20px system-ui, sans-serif";
  ctx.fillText("Tunjukkan QR ini ke resepsionis saat tiba", W / 2, 910);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapCentered(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}
