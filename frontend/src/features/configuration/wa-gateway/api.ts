import { apiGet, apiPatch } from "@/lib/api-client";

export interface GatewayState {
  configured: boolean;
  reachable?: boolean;
  status: {
    connected: boolean;
    phone: string | null;
    needsPairing: boolean;
    lastConnectedAt: string | null;
    lastDisconnectReason: string | null;
  } | null;
  qr: string | null;
  settings?: {
    url: string;
    token_masked: string | null;
    token_from_env: boolean;
  };
}

export const fetchGatewayState = () =>
  apiGet<{ data: GatewayState }>("/api/settings/wa-gateway").then(
    (r) => r.data,
  );

export const saveGatewayConfig = (body: { url: string; token?: string }) =>
  apiPatch<{ data: { configured: boolean; reachable: boolean } }>(
    "/api/settings/wa-gateway",
    body,
  ).then((r) => r.data);

/** Meta WhatsApp Cloud API (EPIC-053 Fase 4). */
export interface MetaSettings {
  provider: "" | "meta" | "gateway";
  phone_number_id: string;
  access_token_masked: string | null;
  access_token_from_env: boolean;
  verify_token: string;
  app_secret_masked: string | null;
  app_secret_from_env: boolean;
  graph_version: string;
  reminder_template: string;
  paid_template: string;
  template_lang: string;
  webhook_url: string;
}

export interface MetaStatus {
  configured: boolean;
  reachable: boolean;
  phone_number: string;
  verified_name: string;
  quality_rating: string;
  error?: string;
}

export interface MetaState {
  settings: MetaSettings;
  status: MetaStatus;
  active_provider: string;
}

export const fetchMetaState = () => apiGet<{ data: MetaState }>("/api/settings/wa-meta").then((r) => r.data);

export const saveMetaConfig = (body: Partial<Record<keyof MetaSettings | "access_token" | "app_secret", string>>) =>
  apiPatch<{ data: { status: MetaStatus; active_provider: string } }>("/api/settings/wa-meta", body).then((r) => r.data);
