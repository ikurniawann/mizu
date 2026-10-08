import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/public/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEPS = new Set(["open", "outlet", "treatment", "time", "contact", "submit", "success", "error"]);

export async function POST(request: Request) {
  if (!checkRateLimit(`spa-funnel:${clientIp(request)}`, { limit: 120, windowMs: 60_000 })) {
    return NextResponse.json({ success: false }, { status: 429 });
  }
  const body = await request.json().catch(() => null) as { session_id?: unknown; step?: unknown; branch_id?: unknown } | null;
  if (!body || typeof body.session_id !== "string" || !UUID.test(body.session_id)
    || typeof body.step !== "string" || !STEPS.has(body.step)
    || (body.branch_id != null && (typeof body.branch_id !== "string" || !UUID.test(body.branch_id)))) {
    return NextResponse.json({ success: false }, { status: 400 });
  }
  try {
    await getPool().query(
      `INSERT INTO spa.public_booking_funnel_events (session_id, step, branch_id)
       VALUES ($1::uuid, $2, $3::uuid) ON CONFLICT (session_id, step) DO NOTHING`,
      [body.session_id, body.step, body.branch_id ?? null]);
    return NextResponse.json({ success: true }, { status: 202 });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
