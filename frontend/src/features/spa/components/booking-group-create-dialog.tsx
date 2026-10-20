"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelForm, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatRupiah } from "@/lib/format";
import { useCreateBookingGroup } from "../mutations";
import { useSpaTherapists, useSpaTreatments } from "../queries";
import { activeVariantOptions, GENDER_PREF_LABEL, isValidPhone, variantPrice } from "../rules";
import { isoToWibLocalInput, wibLocalInputToIso } from "../time";
import type { BookingType, GenderPref, SpaCustomer } from "../types";
import { CustomerSearch } from "./booking-create-dialog";
import { Field, FormError, SELECT, TEXTAREA } from "./shared";

type Person = {
  key: number;
  customerId: string | null;
  name: string;
  phone: string;
  gender: "" | "male" | "female";
  scheduled: string;
  genderPref: GenderPref;
  therapistId: string;
  variants: string[];
  notes: string;
};

function newPerson(key: number, scheduled: string, therapistId = ""): Person {
  return { key, customerId: null, name: "", phone: "", gender: "", scheduled, genderPref: "any", therapistId, variants: [""], notes: "" };
}

export function BookingGroupCreateDialog({ branchId, defaultScheduled, defaultTherapistId, onClose, onCreated }: {
  branchId: string;
  defaultScheduled?: string;
  defaultTherapistId?: string;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [start] = useState(() => defaultScheduled ?? isoToWibLocalInput(new Date(Math.ceil(Date.now() / 900000) * 900000)));
  const [bookingType, setBookingType] = useState<BookingType>(defaultScheduled ? "reservation" : "walk_in");
  const [people, setPeople] = useState<Person[]>(() => [newPerson(1, start, defaultTherapistId), newPerson(2, start)]);
  const [payerKey, setPayerKey] = useState(1);
  const [searchingKey, setSearchingKey] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const treatments = useSpaTreatments(true);
  const therapists = useSpaTherapists({ branch_id: branchId, active: true });
  const options = useMemo(() => activeVariantOptions(treatments.data ?? []), [treatments.data]);
  const create = useCreateBookingGroup();

  const update = (key: number, patch: Partial<Person>) => setPeople((rows) => rows.map((p) => p.key === key ? { ...p, ...patch } : p));
  const total = people.reduce((sum, p) => sum + p.variants.reduce((amount, id) => {
    const option = options.find((o) => o.variant.id === id);
    return amount + (option ? variantPrice(option.variant, branchId) : 0);
  }, 0), 0);

  const submit = () => {
    setError(null);
    const payer = people.find((p) => p.key === payerKey);
    if (!payer || !isValidPhone(payer.phone)) return setError("Pembayar harus memiliki nomor HP valid.");
    const bookings = people.map((p, i) => {
      const scheduled = wibLocalInputToIso(p.scheduled);
      if (!p.name.trim()) throw new Error(`Isi nama orang ${i + 1}.`);
      if (p.phone.trim() && !isValidPhone(p.phone)) throw new Error(`Nomor HP orang ${i + 1} tidak valid.`);
      if (!p.gender) throw new Error(`Pilih gender orang ${i + 1}.`);
      if (!scheduled) throw new Error(`Isi jadwal orang ${i + 1}.`);
      if (!p.variants.some(Boolean)) throw new Error(`Pilih treatment orang ${i + 1}.`);
      return { branch_id: branchId, booking_type: bookingType, customer_id: p.customerId ?? undefined,
        customer_name: p.name.trim(), customer_phone: p.phone.replace(/[\s-]/g, ""), customer_gender: p.gender,
        therapist_gender_pref: p.genderPref, therapist_id: p.therapistId || undefined,
        scheduled_at: scheduled, notes: p.notes.trim() || undefined,
        items: p.variants.filter(Boolean).map((variant_id) => ({ variant_id })) };
    });
    create.mutate({ branch_id: branchId, payer_customer_id: payer.customerId ?? undefined,
      payer_name: payer.name.trim(), payer_phone: payer.phone.replace(/[\s-]/g, ""), bookings }, {
      onSuccess: (group) => { toast.success("Booking bersama dibuat", { description: `${group.bookings.length} orang · satu pembayaran` }); onClose(); onCreated(group.id); },
      onError: (err) => { setError(err.message); toast.error("Booking gagal dibuat", { description: err.message }); },
    });
  };

  const safeSubmit = () => { try { submit(); } catch (err) { setError(err instanceof Error ? err.message : "Data booking tidak valid."); } };

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogPanel size="2xl">
      <DialogPanelForm onSubmit={(event) => { event.preventDefault(); safeSubmit(); }}>
        <DialogPanelHeader>
          <DialogPanelTitle>Booking bersama</DialogPanelTitle>
          <DialogPanelDescription>Setiap orang memiliki jadwal, treatment, dan terapis sendiri. Semua dibayar dalam satu tagihan POS.</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <Field label="Jenis booking"><select className={SELECT} value={bookingType} onChange={(e) => setBookingType(e.target.value as BookingType)}><option value="walk_in">Walk-in</option><option value="reservation">Reservasi</option></select></Field>
          {people.map((p, index) => <section key={p.key} className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Orang {index + 1}</h3>
              {people.length > 2 && <Button type="button" size="sm" variant="ghost" onClick={() => { setPeople((rows) => rows.filter((row) => row.key !== p.key)); if (payerKey === p.key) setPayerKey(people.find((row) => row.key !== p.key)?.key ?? 1); }}><Trash2 /> Hapus</Button>}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="payer" checked={payerKey === p.key} onChange={() => setPayerKey(p.key)} /> Pembayar untuk seluruh grup</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama pelanggan"><Input value={p.name} onChange={(e) => update(p.key, { name: e.target.value, customerId: null })} required /></Field>
              <Field label={payerKey === p.key ? "Nomor HP pembayar" : "Nomor HP (opsional)"}><Input inputMode="tel" value={p.phone} onChange={(e) => update(p.key, { phone: e.target.value, customerId: null })} placeholder="08…" required={payerKey === p.key} /></Field>
              <Field label="Gender pelanggan"><select className={SELECT} value={p.gender} onChange={(e) => update(p.key, { gender: e.target.value as Person["gender"] })} required><option value="">Pilih gender</option><option value="male">Laki-laki</option><option value="female">Perempuan</option></select></Field>
              <Field label="Waktu mulai (WIB)"><Input type="datetime-local" value={p.scheduled} onChange={(e) => update(p.key, { scheduled: e.target.value })} required /></Field>
              <Field label="Preferensi terapis"><select className={SELECT} value={p.genderPref} onChange={(e) => update(p.key, { genderPref: e.target.value as GenderPref })}>{(Object.keys(GENDER_PREF_LABEL) as GenderPref[]).map((g) => <option key={g} value={g}>{GENDER_PREF_LABEL[g]}</option>)}</select></Field>
              <Field label="Terapis booking"><select className={SELECT} value={p.therapistId} onChange={(e) => update(p.key, { therapistId: e.target.value })}><option value="">Tugaskan nanti</option>{(therapists.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setSearchingKey(p.key)}><Search /> Pilih pelanggan tersimpan</Button>
            <div className="space-y-2"><p className="text-sm font-medium">Treatment</p>{p.variants.map((variant, i) => <div key={i} className="flex gap-2"><select className={SELECT} value={variant} aria-label={`Treatment orang ${index + 1}`} onChange={(e) => update(p.key, { variants: p.variants.map((v, j) => j === i ? e.target.value : v) })}><option value="">Pilih treatment…</option>{options.map((o) => <option key={o.variant.id} value={o.variant.id}>{o.label} · {formatRupiah(variantPrice(o.variant, branchId))}</option>)}</select><Button type="button" variant="ghost" size="icon" aria-label="Hapus treatment" disabled={p.variants.length === 1} onClick={() => update(p.key, { variants: p.variants.filter((_, j) => j !== i) })}><Trash2 /></Button></div>)}<Button type="button" size="sm" variant="outline" onClick={() => update(p.key, { variants: [...p.variants, ""] })}><Plus /> Tambah treatment</Button></div>
            <Field label="Catatan"><textarea className={TEXTAREA} value={p.notes} onChange={(e) => update(p.key, { notes: e.target.value })} placeholder="Keluhan, area fokus, alergi…" /></Field>
          </section>)}
          <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" onClick={() => setPeople((rows) => [...rows, newPerson(Math.max(...rows.map((p) => p.key)) + 1, start)])} disabled={people.length >= 10}><Plus /> Tambah orang</Button><p className="font-semibold">Total {formatRupiah(total)}</p></div>
          <FormError>{error}</FormError>
        </DialogPanelBody>
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Batal</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Menyimpan…" : `Buat ${people.length} booking`}</Button></DialogFooter>
      </DialogPanelForm>
    </DialogPanel>
    {searchingKey !== null && <Dialog open onOpenChange={(open) => !open && setSearchingKey(null)}><DialogPanel size="sm"><DialogPanelHeader><DialogPanelTitle>Pilih pelanggan</DialogPanelTitle></DialogPanelHeader><DialogPanelBody><CustomerSearch onPick={(customer: SpaCustomer) => { update(searchingKey, { customerId: customer.id, name: customer.name, phone: customer.phone ?? "", gender: customer.gender ?? "" }); setSearchingKey(null); }} /></DialogPanelBody><DialogFooter><Button type="button" variant="outline" onClick={() => setSearchingKey(null)}>Kembali</Button></DialogFooter></DialogPanel></Dialog>}
  </Dialog>;
}
