/** User-facing labels for configuration.warehouses (storage locations). */
export const STALL_LABELS = {
  singular: "Outlet",
  plural: "Outlets",
  defaultName: "Main Storage",
  defaultCode: "MAIN",
  select: "Select outlet",
  selectPlaceholder: "Select outlet...",
  search: "Search outlet...",
  empty: "No outlet found",
  loading: "Loading outlets...",
  destination: "Destination Outlet",
  allBranchTotal: "All Outlets (Branch Total)",
  perLocation: "outlet location",
} as const;

export function isMainStorageCode(code: string): boolean {
  return code.trim().toUpperCase() === STALL_LABELS.defaultCode;
}

export function isStallCode(code: string): boolean {
  return /^STALL-0*\d+$/i.test(code.trim());
}
