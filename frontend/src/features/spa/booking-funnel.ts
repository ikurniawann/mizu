"use client";

const KEY = "mizu-spa-booking-session";
export type BookingFunnelStep = "open" | "outlet" | "treatment" | "time" | "contact" | "submit" | "success" | "error";

/** Send one anonymous step event; booking details and contact fields stay out of the payload. */
export function trackBookingStep(step: BookingFunnelStep, branchId?: string) {
  if (typeof window === "undefined") return;
  try {
    let session = window.sessionStorage.getItem(KEY);
    if (!session) {
      session = crypto.randomUUID();
      window.sessionStorage.setItem(KEY, session);
    }
    void fetch("/api/public/spa/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session, step, branch_id: branchId || null }),
      keepalive: true,
    }).catch(() => {});
    const layer = (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
    layer?.push({ event: "spa_booking_step", booking_step: step });
  } catch { /* Analytics must never interrupt booking. */ }
}

export function resetBookingFunnel() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* no storage access */ }
}
