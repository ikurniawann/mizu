import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/public/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { issueBookingChangeCode } from "@/lib/spa/booking-change";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!checkRateLimit(`spa-change-code:${clientIp(request)}:${token}`, { limit: 5, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ success: false, error: "Terlalu banyak permintaan." }, { status: 429 });
  }
  try {
    const result = await issueBookingChangeCode(token);
    return result.ok
      ? NextResponse.json({ success: true, data: { phone_hint: result.phoneHint } })
      : NextResponse.json({ success: false, error: result.error }, { status: result.status });
  } catch {
    return NextResponse.json({ success: false, error: "Kode belum bisa dikirim." }, { status: 500 });
  }
}
