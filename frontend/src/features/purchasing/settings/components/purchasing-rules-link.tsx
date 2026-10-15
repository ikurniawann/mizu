"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";

/** Tautan kecil "Aturan PO" ke Pengaturan Pembelian; hanya untuk yang punya menu tersebut. */
export function PurchasingRulesLink({ href = RM_ROUTES.purchasingSettings }: { href?: string }) {
  const { hasPrefix } = useIamAccess();
  if (!hasPrefix(IAM.itemsPurchasingSettings)) return null;
  return (
    <Link href={href}>
      <Button type="button" variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
        <Settings2 className="mr-2 h-4 w-4" />
        Aturan PO
      </Button>
    </Link>
  );
}
