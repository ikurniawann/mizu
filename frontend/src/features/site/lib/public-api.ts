import "server-only";
import { appOrigin } from "@/lib/app-origin";
import { backendUrl } from "@/lib/env";
import { withDefaults } from "../content-defaults";
import { addDays, weekWindow, type PublicSession, type PublicTimetable } from "./timetable";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import type { Article, BranchProfile, BranchSummary, ContentByKey, ContentKey, PublicPlansView, SiteEvent } from "../types";

/**
 * Server-side reads of the public site API. Pages render from these; a
 * failed request yields the defaults or an empty list so the shell still
 * renders during an API outage.
 */

function base(): string {
  return backendUrl() || appOrigin();
}

/** One public API read: the envelope's data, or null when it failed. */
async function readApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base()}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: T };
    return json.success ? (json.data ?? null) : null;
  } catch (error) {
    console.error(`[site] fetch ${path} failed:`, error);
    return null;
  }
}

function read<T>(path: string): Promise<T | null> {
  return readApi<T>(`/api/public/site${path}`);
}

export async function fetchContent<K extends ContentKey>(key: K): Promise<ContentByKey[K]> {
  return withDefaults(key, await read<unknown>(`/content/${key}`));
}

export async function fetchBranches(): Promise<BranchSummary[]> {
  return (await read<BranchSummary[]>("/branches")) ?? [];
}

export function fetchBranch(slug: string): Promise<BranchProfile | null> {
  return read<BranchProfile>(`/branches/${encodeURIComponent(slug)}`);
}

export async function fetchArticles(category?: string): Promise<Article[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  return (await read<Article[]>(`/articles${query}`)) ?? [];
}

export function fetchArticle(slug: string): Promise<Article | null> {
  return read<Article>(`/articles/${encodeURIComponent(slug)}`);
}

export async function fetchEvents(): Promise<SiteEvent[]> {
  return (await read<SiteEvent[]>("/events")) ?? [];
}

/** The next bookable classes at the visitor's branch, across the current and next week. */
export async function fetchUpcomingSessions(branchSlug: string, now = new Date()): Promise<PublicSession[]> {
  const monday = weekWindow(now).first;
  const weeks = [monday, addDays(monday, 7)];
  const timetables = await Promise.all(weeks.map((week) =>
    read<PublicTimetable>(`/sessions?branch=${encodeURIComponent(branchSlug)}&week=${week}`)
  ));
  return timetables.flatMap((table) => table?.sessions ?? [])
    .filter((session) => new Date(session.starts_at).getTime() > now.getTime())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3);
}

export function fetchEvent(slug: string): Promise<SiteEvent | null> {
  return read<SiteEvent>(`/events/${encodeURIComponent(slug)}`);
}

const NO_PLANS: PublicPlansView = { branch: null, plans: [] };

/** The price list of a branch; an unknown slug falls back to the base prices. */
export async function fetchPlans(branchSlug?: string): Promise<PublicPlansView> {
  if (branchSlug) {
    const priced = await read<PublicPlansView>(`/plans?branch=${encodeURIComponent(branchSlug)}`);
    if (priced) return priced;
  }
  return (await read<PublicPlansView>("/plans")) ?? NO_PLANS;
}

/** A list read that keeps "the API failed" apart from "nothing published". */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

async function loadList<T>(path: string): Promise<Loaded<T[]>> {
  const data = await readApi<T[]>(path);
  return Array.isArray(data) ? { ok: true, data } : { ok: false };
}

/** Spa outlets open for online booking (GET /api/public/spa/outlets). */
export function fetchSpaOutlets(): Promise<Loaded<PublicOutlet[]>> {
  return loadList<PublicOutlet>("/api/public/spa/outlets");
}

/** The treatment menu of one outlet, with that outlet's prices. */
export function fetchSpaTreatments(branchId: string): Promise<Loaded<PublicTreatment[]>> {
  return loadList<PublicTreatment>(`/api/public/spa/outlets/${encodeURIComponent(branchId)}/treatments`);
}
