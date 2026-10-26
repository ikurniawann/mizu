import { send } from "./api";
import type { DayOffQuota } from "./types";
export type RosterCell = { employee_id: string; name: string; date: string; branch_id: string; gender: string; shift_id: string; kind: "work" | "off" | "leave" | "unscheduled"; locked: boolean; reason?: string };
export type RosterRequest = { branch_id: string; month: string; shift_ids: string[]; replace_existing: boolean; cells?: RosterCell[]; revision?: string };
export type RosterPreview = { status: "valid" | "infeasible" | "search_limit"; cells: RosterCell[]; revision: string; quota: DayOffQuota; score: number; violations: { code: string; date: string; employee_id?: string; message: string }[] };
export const previewRoster = (input: RosterRequest) => send<RosterPreview>("/api/spa/rosters/preview", input);
export const applyRoster = (input: RosterRequest) => send<RosterPreview>("/api/spa/rosters/apply", input);
