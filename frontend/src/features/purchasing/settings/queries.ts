"use client";

import { useQuery } from "@tanstack/react-query";
import { getPurchasingSettings } from "./api";
import { purchasingSettingsQueryKeys } from "./query-keys";

export const usePurchasingSettings = () =>
  useQuery({
    queryKey: purchasingSettingsQueryKeys.all,
    queryFn: getPurchasingSettings,
    staleTime: 60_000,
  });
