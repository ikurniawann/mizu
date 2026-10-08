"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatRupiah } from "@/lib/format";
import { useCreateBooking } from "../mutations";
import { useSpaCustomers, useSpaTherapists, useSpaTreatments } from "../queries";
import { activeVariantOptions, GENDER_PREF_LABEL, isValidPhone, variantPrice } from "../rules";
import { isoToWibLocalInput, wibLocalInputToIso } from "../time";
import type { BookingType, GenderPref, Outlet, SpaCustomer } from "../types";
import { Field, FormError, OutletSelect, SELECT, TEXTAREA } from "./shared";

interface ItemRow {
  key: number;
  variant_id: string;
  therapist_id: string;
}

/** Waktu sekarang dibulatkan ke 15 menit berikutnya, untuk input datetime-local WIB. */
function defaultStart(): string {
  const step = 15 * 60 * 1000;
  return isoToWibLocalInput(new Date(Math.ceil(Date.now() / step) * step));
}

/** Pencarian pelanggan POS (find-or-create berdasarkan HP terjadi di server). */
export function CustomerSearch({ onPick }: { onPick: (customer: SpaCustomer) => void }) {
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q.trim(), 300);
  const customers = useSpaCustomers(debounced);
  const rows = customers.data ?? [];
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pelanggan lama (nama / HP)…" aria-label="Cari pelanggan" />
      {debounced.length >= 2 && (
        <div className="max-h-40 overflow-y-auto rounded-2xl border border-border">
          {customers.isLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Mencari…</p>
          ) : customers.error ? (
            <p className="px-3 py-2 text-xs text-danger">{customers.error.message}</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Tidak ditemukan — isi nama & HP di bawah untuk pelanggan baru.</p>
          ) : (
            rows.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
                onClick={() => {
                  onPick(c);
                  setQ("");
                }}
              >
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Dialog "Booking baru" dari dashboard (walk-in atau reservasi). */
export function BookingCreateDialog({
  outlets,
  defaultBranchId,
  onClose,
}: {
  outlets: Outlet[];
  defaultBranchId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const usable = outlets.filter((o) => o.configured && o.is_active);
  const [branchId, setBranchId] = useState(
    defaultBranchId && usable.some((o) => o.branch_id === defaultBranchId) ? defaultBranchId : (usable[0]?.branch_id ?? "")
  );
  const [bookingType, setBookingType] = useState<BookingType>("walk_in");
  const [scheduled, setScheduled] = useState(defaultStart);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [genderPref, setGenderPref] = useState<GenderPref>("any");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ key: 1, variant_id: "", therapist_id: "" }]);
  const [error, setError] = useState<string | null>(null);

  const treatments = useSpaTreatments(true);
  const therapists = useSpaTherapists({ branch_id: branchId || undefined, active: true });
  const options = useMemo(() => activeVariantOptions(treatments.data ?? []), [treatments.data]);
  const create = useCreateBooking();

  const total = items.reduce((sum, row) => {
    const opt = options.find((o) => o.variant.id === row.variant_id);
    return sum + (opt ? variantPrice(opt.variant, branchId) : 0);
  }, 0);

  const updateItem = (key: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    setError(null);
    const scheduledIso = wibLocalInputToIso(scheduled);
    const chosen = items.filter((r) => r.variant_id);
    if (!branchId) return setError("Pilih outlet.");
    if (!scheduledIso) return setError("Isi waktu booking.");
    if (!name.trim()) return setError("Nama pelanggan wajib diisi.");
    if (!isValidPhone(phone)) return setError("Nomor HP tidak valid (8–15 digit).");
    if (chosen.length === 0) return setError("Pilih minimal satu treatment.");
    create.mutate(
      {
        branch_id: branchId,
        booking_type: bookingType,
        customer_id: customerId ?? undefined,
        customer_name: name.trim(),
        customer_phone: phone.replace(/[\s-]/g, ""),
        therapist_gender_pref: genderPref,
        notes: notes.trim() || undefined,
        scheduled_at: scheduledIso,
        items: chosen.map((r) => ({ variant_id: r.variant_id, therapist_id: r.therapist_id || undefined })),
      },
      {
        onSuccess: (booking) => {
          toast.success("Booking dibuat", { description: `${booking.booking_code} · ${booking.customer_name}` });
          onClose();
          router.push(`/dashboard/spa/bookings/${booking.id}`);
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Booking gagal dibuat", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Booking baru</DialogPanelTitle>
            <DialogPanelDescription>
              Semua treatment dijadwalkan mulai pada waktu booking; jam per item dapat diubah di detail booking. Terapis boleh
              dikosongkan dan ditugaskan nanti.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Outlet">
              <OutletSelect
                outlets={usable}
                value={branchId}
                onChange={(v) => {
                  setBranchId(v);
                  setItems((rows) => rows.map((r) => ({ ...r, therapist_id: "" })));
                }}
                className={SELECT}
                required
              />
            </Field>
            <Field label="Jenis booking">
              <select className={SELECT} value={bookingType} onChange={(e) => setBookingType(e.target.value as BookingType)}>
                <option value="walk_in">Walk-in</option>
                <option value="reservation">Reservasi</option>
              </select>
            </Field>
            <Field label="Waktu mulai (WIB)">
              <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} required />
            </Field>
            <Field label="Preferensi terapis">
              <select className={SELECT} value={genderPref} onChange={(e) => setGenderPref(e.target.value as GenderPref)}>
                {(Object.keys(GENDER_PREF_LABEL) as GenderPref[]).map((g) => (
                  <option key={g} value={g}>
                    {GENDER_PREF_LABEL[g]}
                  </option>
                ))}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-medium">Pelanggan</p>
              <CustomerSearch
                onPick={(c) => {
                  setCustomerId(c.id);
                  setName(c.name);
                  setPhone(c.phone ?? "");
                }}
              />
            </div>
            <Field label="Nama pelanggan">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setCustomerId(null);
                }}
                required
              />
            </Field>
            <Field label="Nomor HP">
              <Input
                value={phone}
                inputMode="tel"
                onChange={(e) => {
                  setPhone(e.target.value);
                  setCustomerId(null);
                }}
                placeholder="08…"
                required
              />
            </Field>

            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Treatment</p>
              {treatments.error && <p className="text-xs text-danger">{treatments.error.message}</p>}
              {items.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-1 gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto]"
                >
                  <select
                    className={SELECT}
                    value={row.variant_id}
                    aria-label="Treatment"
                    onChange={(e) => updateItem(row.key, { variant_id: e.target.value })}
                  >
                    <option value="">{treatments.isLoading ? "Memuat treatment…" : "Pilih treatment…"}</option>
                    {options.map((o) => (
                      <option key={o.variant.id} value={o.variant.id}>
                        {o.label} · {formatRupiah(variantPrice(o.variant, branchId))}
                      </option>
                    ))}
                  </select>
                  <select
                    className={SELECT}
                    value={row.therapist_id}
                    aria-label="Terapis"
                    onChange={(e) => updateItem(row.key, { therapist_id: e.target.value })}
                  >
                    <option value="">Terapis nanti</option>
                    {(therapists.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus treatment"
                    disabled={items.length === 1}
                    onClick={() => setItems((rows) => rows.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setItems((rows) => [...rows, { key: Math.max(0, ...rows.map((r) => r.key)) + 1, variant_id: "", therapist_id: "" }])
                  }
                >
                  <Plus /> Tambah treatment
                </Button>
                <p className="text-sm">
                  Total <span className="font-semibold tabular-nums">{formatRupiah(total)}</span>
                </p>
              </div>
            </div>

            <Field label="Catatan" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Keluhan, area fokus, alergi…" />
            </Field>
            <div className="sm:col-span-2">
              <FormError>{error}</FormError>
              {usable.length === 0 && (
                <FormError>Belum ada outlet spa aktif. Atur dulu di menu Outlet Spa.</FormError>
              )}
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={create.isPending || usable.length === 0}>
              {create.isPending ? "Menyimpan…" : "Buat booking"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
