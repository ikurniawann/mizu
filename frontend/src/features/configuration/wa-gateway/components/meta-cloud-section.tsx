"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Cloud, Loader2, WifiOff } from "lucide-react";
import { fetchMetaState, saveMetaConfig, type MetaSettings } from "../api";

/**
 * Settings → WhatsApp Gateway → Meta Cloud API (EPIC-053 Fase 4): jalur
 * resmi WhatsApp Business Platform. Nomor Meta tidak boleh dipakai di
 * aplikasi WhatsApp biasa; kredensial dari developers.facebook.com.
 */

const input =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

type Draft = Partial<MetaSettings> & { access_token?: string; app_secret?: string };

export function MetaCloudSection() {
  const query = useQuery({ queryKey: ["settings", "wa-meta"], queryFn: fetchMetaState });
  const state = query.data ?? null;
  // Edits start from the saved settings; null = untouched since the last load.
  const [edits, setEdits] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const draft: Draft = edits ?? (state ? { ...state.settings, access_token: "", app_secret: "" } : {});

  const field = (key: keyof Draft) => ({
    value: (draft[key] as string | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEdits({ ...draft, [key]: e.target.value }),
  });

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveMetaConfig({
        provider: draft.provider ?? "",
        phone_number_id: draft.phone_number_id ?? "",
        access_token: draft.access_token || undefined,
        verify_token: draft.verify_token ?? "",
        app_secret: draft.app_secret || undefined,
        graph_version: draft.graph_version ?? "",
        reminder_template: draft.reminder_template ?? "",
        paid_template: draft.paid_template ?? "",
        template_lang: draft.template_lang ?? "",
      });
      setMessage(
        result.status.reachable
          ? `Tersimpan — nomor ${result.status.phone_number} (${result.status.verified_name}) terhubung. Provider aktif: ${result.active_provider || "tidak ada"}.`
          : result.status.configured
            ? `Tersimpan, tapi Meta menolak kredensial: ${result.status.error ?? "tidak diketahui"}.`
            : "Tersimpan. Isi Phone Number ID dan access token untuk mengaktifkan Meta.",
      );
      setEdits(null);
      await query.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const status = state?.status;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
        <Cloud className="size-4 text-sky-600" /> Meta Cloud API (jalur resmi)
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Alternatif gateway Baileys tanpa risiko blokir: nomor didaftarkan ke WhatsApp Business Account di
        developers.facebook.com. Bot memakai tombol/daftar interaktif, dan pengingat di luar jendela 24 jam dikirim
        lewat template yang disetujui Meta.
      </p>

      {status && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
            status.reachable
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : status.configured
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {status.reachable ? <CheckCircle2 className="mt-0.5 size-4" /> : <WifiOff className="mt-0.5 size-4" />}
          <div>
            {status.reachable
              ? `Terhubung: ${status.phone_number} (${status.verified_name}${status.quality_rating ? `, kualitas ${status.quality_rating}` : ""})`
              : status.configured
                ? `Meta tidak merespons: ${status.error ?? "tidak diketahui"}`
                : "Belum dikonfigurasi."}
            <div className="text-xs opacity-80">Provider aktif saat ini: {state?.active_provider || "tidak ada"}</div>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Provider pengiriman</span>
          <select {...field("provider")} className={input}>
            <option value="">Otomatis (Meta bila terisi, kalau tidak gateway)</option>
            <option value="meta">Meta Cloud API</option>
            <option value="gateway">Gateway Baileys</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Phone Number ID</span>
          <input {...field("phone_number_id")} placeholder="1234567890123" className={input} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Graph API version</span>
          <input {...field("graph_version")} placeholder="v21.0" className={input} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Access token (permanen, System User)</span>
          <input
            type="password"
            {...field("access_token")}
            placeholder={
              state?.settings.access_token_masked
                ? `Tersimpan: ${state.settings.access_token_masked} — isi hanya untuk mengganti`
                : state?.settings.access_token_from_env
                  ? "Memakai META_WA_ACCESS_TOKEN dari ENV — isi untuk pindah ke database"
                  : "EAAG…"
            }
            className={input}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Verify token (webhook)</span>
          <input {...field("verify_token")} placeholder="bebas, samakan di Meta" className={input} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">App secret</span>
          <input
            type="password"
            {...field("app_secret")}
            placeholder={
              state?.settings.app_secret_masked
                ? `Tersimpan: ${state.settings.app_secret_masked} — isi hanya untuk mengganti`
                : state?.settings.app_secret_from_env
                  ? "Memakai META_WA_APP_SECRET dari ENV"
                  : "dari Pengaturan aplikasi Meta"
            }
            className={input}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Template pengingat</span>
          <input {...field("reminder_template")} placeholder="spa_reminder" className={input} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Template konfirmasi lunas</span>
          <input {...field("paid_template")} placeholder="spa_paid" className={input} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Bahasa template</span>
          <input {...field("template_lang")} placeholder="id" className={input} />
        </label>
      </div>

      {state?.settings.webhook_url && (
        <p className="mt-3 text-xs text-slate-500">
          Webhook di Meta: <code className="rounded bg-slate-100 px-1">{state.settings.webhook_url}</code> dengan verify
          token di atas; langganan field <code className="rounded bg-slate-100 px-1">messages</code>. Parameter
          template pengingat: {"{{1}}"} nama, {"{{2}}"} kode, {"{{3}}"} outlet, {"{{4}}"} jadwal, {"{{5}}"} treatment,{" "}
          {"{{6}}"} link; konfirmasi lunas: {"{{1}}"} nama, {"{{2}}"} kode, {"{{3}}"} outlet, {"{{4}}"} jadwal, {"{{5}}"}{" "}
          total, {"{{6}}"} link. Panduan lengkap: docs/crm/RUNBOOK-META-CLOUD-API.md.
        </p>
      )}

      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || query.isLoading}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        Simpan & cek Meta
      </button>
    </div>
  );
}
