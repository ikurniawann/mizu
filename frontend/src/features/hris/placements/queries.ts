"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchClockPlacements,
  fetchEmployeePlacements,
  fetchPlacementOverview,
  fetchStoreBranches,
} from "./api";
import { placementQueryKeys } from "./query-keys";
import type { PlacementOverviewFilter } from "./types";

export const useStoreBranches = () =>
  useQuery({ queryKey: placementQueryKeys.branches(), queryFn: fetchStoreBranches, staleTime: 5 * 60_000 });

export const useEmployeePlacements = (employeeId: string) =>
  useQuery({
    queryKey: placementQueryKeys.employee(employeeId),
    queryFn: () => fetchEmployeePlacements(employeeId),
    enabled: !!employeeId,
  });

export const usePlacementOverview = (filter: PlacementOverviewFilter) =>
  useQuery({ queryKey: placementQueryKeys.overview(filter), queryFn: () => fetchPlacementOverview(filter) });

export const useClockPlacements = (employeeId?: string, enabled = true) =>
  useQuery({
    queryKey: placementQueryKeys.clock(employeeId),
    queryFn: () => fetchClockPlacements(employeeId),
    enabled,
  });
