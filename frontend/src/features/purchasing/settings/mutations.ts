"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updatePurchasingSettings, type PurchasingSettings } from "./api";
import { purchasingSettingsQueryKeys } from "./query-keys";

export const useUpdatePurchasingSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PurchasingSettings>) => updatePurchasingSettings(patch),
    onSuccess: (data) => queryClient.setQueryData(purchasingSettingsQueryKeys.all, data),
  });
};
