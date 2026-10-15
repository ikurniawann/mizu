"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayWib } from "@/lib/dates";
import { useBulkPlacement } from "../mutations";
import { useStoreBranches } from "../queries";

interface BulkPlacementDialogProps {
  open: boolean;
  employeeIds: string[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** Tempatkan beberapa karyawan sekaligus ke satu toko (yang sudah ditempatkan di sana dilewati). */
export function BulkPlacementDialog({ open, employeeIds, onOpenChange, onDone }: BulkPlacementDialogProps) {
  const branches = useStoreBranches();
  const bulk = useBulkPlacement();
  const [branchId, setBranchId] = useState("");
  const [startDate, setStartDate] = useState(() => todayWib());
  const [primary, setPrimary] = useState(false);

  function handleSave() {
    if (!branchId) {
      toast.error("Pilih toko");
      return;
    }
    bulk.mutate(
      { branch_id: branchId, employee_ids: employeeIds, is_primary: primary, start_date: startDate },
      {
        onSuccess: (res) => {
          toast.success(res.message || "Penempatan ditambahkan");
          onDone();
        },
        onError: (error) => toast.error(error.message || "Gagal menempatkan karyawan"),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tempatkan {employeeIds.length} karyawan ke toko</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Toko</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih toko" />
              </SelectTrigger>
              <SelectContent>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Mulai</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
            <span>
              Jadikan penempatan utama
              <span className="block text-xs text-gray-400">
                Penempatan utama lama pada rentang yang sama dilepas (tetap tercatat sebagai toko tambahan).
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulk.isPending}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={bulk.isPending}>
            {bulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tempatkan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
