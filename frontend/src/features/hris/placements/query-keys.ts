import type { PlacementOverviewFilter } from "./types";

export const placementQueryKeys = {
  all: ["hris", "placements"] as const,
  branches: () => ["hris", "placements", "branches"] as const,
  employee: (employeeId: string) => ["hris", "placements", "employee", employeeId] as const,
  overview: (filter: PlacementOverviewFilter) => ["hris", "placements", "overview", filter] as const,
  clock: (employeeId?: string) => ["hris", "placements", "clock", employeeId ?? "me"] as const,
};
