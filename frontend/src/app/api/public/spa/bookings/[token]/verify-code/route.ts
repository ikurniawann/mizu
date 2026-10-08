import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/public/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { verifyBookingChangeCode } from "@/lib/spa/booking-change";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!checkRateLimit(`spa-verify-code:${clientIp(request)}:${token}`, { limit: 15, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ success: false, error: "Terlalu banyak percobaan." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({})) as { code?: unknown };
  try {
    const result = await verifyBookingChangeCode(token, String(body.code ?? ""));
    return result.ok
      ? NextResponse.json({ success: true, data: { grant: result.grant } })
      : NextResponse.json({ success: false, error: result.error }, { status: result.status });
  } catch {
    return NextResponse.json({ success: false, error: "Kode belum bisa diperiksa." }, { status: 500 });
  }
}
