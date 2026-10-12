"use client";

import { Bot, ExternalLink, Loader2, UserRound } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { BOT_HANDOVER_LABELS, BOT_STEP_LABELS, type InboxConversation } from "../types";
import { useBotSession, useSetBotActive } from "../queries";

/**
 * EPIC-053 — status bot booking untuk percakapan WhatsApp ini: siapa yang
 * menjawab (bot/agent), langkah booking yang sedang berjalan, ringkasan
 * pilihan customer, dan booking yang sudah dibuat. Agent bisa mengambil alih
 * atau menyerahkan kembali ke bot.
 */
export function BotPanel({ conversation }: { conversation: InboxConversation }) {
  const sessionQuery = useBotSession(conversation.id);
  const toggle = useSetBotActive(conversation.id);
  const session = sessionQuery.data ?? null;
  const active = session?.active ?? conversation.bot_active ?? false;
  const reason = session?.handover_reason ?? conversation.bot_handover_reason ?? null;
  const error = toggle.error instanceof Error ? toggle.error.message : null;

  return (
    <div className="border-b border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Bot className="size-3.5" /> Bot booking
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            active ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {active ? "Aktif" : "Dipegang agent"}
        </span>
      </div>

      {sessionQuery.isLoading ? (
        <div className="mt-3 flex justify-center">
          <Loader2 className="size-4 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          {session?.step ? (
            <div>
              <span className="text-slate-400">Langkah:</span>{" "}
              <span className="font-medium text-slate-800">{BOT_STEP_LABELS[session.step] ?? session.step}</span>
            </div>
          ) : (
            <div className="text-slate-400">Belum ada sesi booking lewat bot.</div>
          )}
          {!active && reason && (
            <div>
              <span className="text-slate-400">Alasan:</span> {BOT_HANDOVER_LABELS[reason.split(":")[0]] ?? reason}
            </div>
          )}
          {session && session.summary.length > 0 && (
            <ul className="space-y-0.5 rounded-md bg-slate-50 px-2.5 py-2">
              {session.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {session && session.bookings.length > 0 && (
            <div className="space-y-1">
              <div className="text-slate-400">Booking dibuat bot:</div>
              {session.bookings.map((booking) => (
                <a
                  key={booking.code}
                  href={booking.status_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50"
                >
                  <span>
                    <span className="font-semibold text-slate-800">{booking.code}</span>
                    <span className="text-slate-400"> · {booking.customer}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-400">
                    {booking.paid ? "Lunas" : booking.pay_url ? "Menunggu bayar" : "Bayar di outlet"}
                    <ExternalLink className="size-3" />
                  </span>
                </a>
              ))}
            </div>
          )}
          {session?.last_bot_at && (
            <div className="text-[10px] text-slate-400">
              Balasan bot terakhir {formatDateTime(session.last_bot_at)}
              {session.last_latency_ms != null && ` · ${(session.last_latency_ms / 1000).toFixed(1)} dtk`}
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}

      <button
        type="button"
        onClick={() => toggle.mutate(!active)}
        disabled={toggle.isPending}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      >
        {toggle.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : active ? (
          <UserRound className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
        {active ? "Ambil alih dari bot" : "Serahkan ke bot"}
      </button>
      <p className="mt-1.5 text-[10px] text-slate-400">
        Membalas lewat inbox juga otomatis mengambil alih percakapan dari bot.
      </p>
    </div>
  );
}
