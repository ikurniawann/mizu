"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { todayWib } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import {
  useCreateAssist,
  useCreateOutletPic,
  useCreateTherapist,
  useDeleteAssist,
  useDeleteOutletPic,
  useUpdateTherapist,
} from "../mutations";
import { useSpaAssists, useSpaEmployees, useSpaOutletPics, useSpaOutlets, useSpaTherapists } from "../queries";
import { send } from "../api";
import { genderLabel } from "../rules";
import type { Assist, EmployeeCandidate, Outlet, OutletPic, Therapist } from "../types";
import { DayOffAdminTab } from "./day-off-admin-tab";
import { EMPLOYEES_ROUTES, STATUS_LABELS } from "@/features/users/constants";
import { TherapistSchedulePage } from "./therapist-schedule-page";
import { Field, FormError, OutletSelect, SELECT, SPA_KICKER, TableNote, TEXTAREA } from "./shared";

/** Spa → Terapis: daftar terapis, perbantuan antar-outlet, dan PIC outlet. */
export function SpaTherapistsPage({ canViewCommission = false }: { canViewCommission?: boolean } = {}) {
  const outlets = useSpaOutlets();
  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Terapis"
        description="Terapis berasal dari data karyawan HRIS. Terapis boleh ditugaskan di outlet asalnya, atau di outlet lain selama ada perbantuan aktif pada tanggal itu."
      />
      {canViewCommission && <Link className="text-sm text-brand-text underline" href="/dashboard/spa/commission-settings">Lihat tarif komisi per level dan varian</Link>}
      <Tabs defaultValue="therapists" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="therapists">Terapis</TabsTrigger>
          <TabsTrigger value="assists">Perbantuan</TabsTrigger>
          <TabsTrigger value="pics">PIC Outlet</TabsTrigger>
          <TabsTrigger value="schedule">Jadwal Shift</TabsTrigger>
          <TabsTrigger value="day-offs">Jadwal Libur</TabsTrigger>
        </TabsList>
        <TabsContent value="therapists" className="mt-4">
          <TherapistsTab outlets={outlets.data ?? []} />
        </TabsContent>
        <TabsContent value="assists" className="mt-4">
          <AssistsTab outlets={outlets.data ?? []} />
        </TabsContent>
        <TabsContent value="pics" className="mt-4">
          <PicsTab outlets={outlets.data ?? []} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-4">
          <TherapistSchedulePage embedded />
        </TabsContent>
        <TabsContent value="day-offs" className="mt-4">
          <DayOffAdminTab outlets={outlets.data ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Pencarian karyawan ───────────────────────────────────────────────────────

function EmployeeSearch({
  selected,
  onPick,
  disableTherapists,
}: {
  selected: EmployeeCandidate | null;
  onPick: (employee: EmployeeCandidate | null) => void;
  disableTherapists?: boolean;
}) {
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q.trim(), 300);
  const employees = useSpaEmployees(debounced);
  const rows = employees.data ?? [];

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
        <div>
          <p className="font-medium">{selected.full_name}</p>
          <p className="text-xs text-muted-foreground">
            {selected.nip ?? "-"}
            {selected.position_title ? ` · ${selected.position_title}` : ""}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
          Ganti
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau NIP karyawan (min. 2 huruf)" aria-label="Cari karyawan" />
      {debounced.length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded-2xl border border-border">
          {employees.isLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Mencari…</p>
          ) : employees.error ? (
            <p className="px-3 py-2 text-xs text-danger">{employees.error.message}</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Karyawan tidak ditemukan.</p>
          ) : (
            rows.map((e) => {
              const disabled = disableTherapists && e.is_therapist;
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={disabled}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => onPick(e)}
                >
                  <span>
                    <span className="font-medium">{e.full_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {e.nip ?? "-"}
                      {e.position_title ? ` · ${e.position_title}` : ""}
                    </span>
                  </span>
                  {e.is_therapist && <Badge variant="muted">Sudah terapis</Badge>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab Terapis ──────────────────────────────────────────────────────────────

function TherapistsTab({ outlets }: { outlets: Outlet[] }) {
  const [branchId, setBranchId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [level, setLevel] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const therapists = useSpaTherapists({ branch_id: branchId || undefined, active: showInactive ? undefined : true });
  const [editing, setEditing] = useState<Therapist | "new" | null>(null);
  const rows = (therapists.data ?? []).filter((t) => (level === "" || (t.level ?? 0) === Number(level)) && (!employmentStatus || t.employment_status === employmentStatus));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} allLabel="Semua outlet" onlyConfigured={false} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Tampilkan nonaktif" />
          Tampilkan nonaktif
        </label>
        <select aria-label="Filter level terapis" className={SELECT} value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Semua level</option>{[0, 1, 2].map((n) => <option key={n} value={n}>Level {n}</option>)}
        </select>
        <select aria-label="Filter kepegawaian terapis" className={SELECT} value={employmentStatus} onChange={(e) => { setEmploymentStatus(e.target.value); if (e.target.value === "resigned") setShowInactive(true); }}>
          <option value="">Semua status kepegawaian</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{value === "resigned" ? "Resign" : label}</option>)}
        </select>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <Plus /> Tambah terapis
        </Button>
      </div>
      <Card className="py-0">
        {therapists.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={4} rows={5} />
          </div>
        ) : therapists.error ? (
          <TableNote tone="danger">{therapists.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada terapis{branchId ? " di outlet ini" : ""}.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terapis</TableHead>
                <TableHead>Outlet asal</TableHead>
                <TableHead className="hidden sm:table-cell">Gender</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Kepegawaian</TableHead>
                <TableHead>Aktif/nonaktif</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={t.is_active ? undefined : "opacity-60"}>
                  <TableCell>
                    <p className="font-medium">{t.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.nip ?? "-"}
                      {t.phone ? ` · ${t.phone}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>{t.home_branch_name ?? "-"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{genderLabel(t.gender)}</TableCell>
                  <TableCell><Badge variant="muted">Level {t.level ?? 0}</Badge></TableCell>
                  <TableCell>{t.employment_status === "resigned" ? "Resign" : STATUS_LABELS[t.employment_status] ?? t.employment_status ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.is_active ? "success" : "muted"}>{t.is_active ? "Aktif" : "Nonaktif"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      <Pencil /> Ubah
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && (
        <TherapistDialog therapist={editing === "new" ? null : editing} outlets={outlets} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TherapistDialog({ therapist, outlets, onClose }: { therapist: Therapist | null; outlets: Outlet[]; onClose: () => void }) {
  const [employee, setEmployee] = useState<EmployeeCandidate | null>(null);
  const [homeBranch, setHomeBranch] = useState(therapist?.home_branch_id ?? outlets.find((o) => o.configured)?.branch_id ?? "");
  const [active, setActive] = useState(therapist?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateTherapist();
  const update = useUpdateTherapist();
  const pending = create.isPending || update.isPending;
  const employeeGender = therapist?.gender ?? employee?.gender;

  const submit = () => {
    if (!therapist && !employee) return setError("Pilih karyawan.");
    if (!homeBranch) return setError("Pilih outlet asal.");
    setError(null);
    const done = (name: string) => {
      toast.success(therapist ? "Terapis diperbarui" : "Terapis ditambahkan", { description: name });
      onClose();
    };
    const fail = (err: Error) => {
      setError(err.message);
      toast.error("Terapis gagal disimpan", { description: err.message });
    };
    if (therapist) {
      update.mutate(
        { id: therapist.id, input: { home_branch_id: homeBranch, is_active: active } },
        { onSuccess: (t) => done(t.full_name), onError: fail }
      );
    } else if (employee) {
      create.mutate(
        { employee_id: employee.id, home_branch_id: homeBranch, is_active: active },
        { onSuccess: (t) => done(t.full_name), onError: fail }
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{therapist ? `Ubah ${therapist.full_name}` : "Tambah terapis"}</DialogPanelTitle>
            <DialogPanelDescription>Gender mengikuti data karyawan untuk mencocokkan preferensi pelanggan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            {!therapist && (
              <div>
                <p className="mb-1.5 text-sm font-medium">Karyawan</p>
                <EmployeeSearch selected={employee} onPick={setEmployee} disableTherapists />
              </div>
            )}
            <Field label="Outlet asal">
              <OutletSelect outlets={outlets} value={homeBranch} onChange={setHomeBranch} className={SELECT} onlyConfigured={false} required />
            </Field>
            <Field label="Gender karyawan">
              <p className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">
                {employeeGender ? genderLabel(employeeGender) : "Belum diisi di data karyawan"}
              </p>
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={active} onCheckedChange={setActive} disabled={therapist?.employment_status === "resigned"} aria-label="Terapis aktif" />
              Aktif (dapat ditugaskan)
            </label>
            {therapist && <p className="text-sm text-muted-foreground">Status kepegawaian diatur di <Link className="underline" href={EMPLOYEES_ROUTES.detail(therapist.employee_id)}>profil karyawan</Link>. Nonaktif sementara mempertahankan level; masuk kembali setelah resign memulai Level 0.</p>}
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

// ── Tab Perbantuan ───────────────────────────────────────────────────────────

function AssistsTab({ outlets }: { outlets: Outlet[] }) {
  const [today] = useState(() => todayWib());
  const [branchId, setBranchId] = useState("");
  const [includePast, setIncludePast] = useState(false);
  const assists = useSpaAssists({ branch_id: branchId || undefined, from: includePast ? undefined : today });
  const remove = useDeleteAssist();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Assist | null>(null);
  const rows = assists.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} allLabel="Semua outlet tujuan" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={includePast} onCheckedChange={setIncludePast} aria-label="Termasuk yang sudah lewat" />
          Termasuk yang sudah lewat
        </label>
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          <Plus /> Tambah perbantuan
        </Button>
      </div>
      <Card className="py-0">
        {assists.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={4} rows={4} />
          </div>
        ) : assists.error ? (
          <TableNote tone="danger">{assists.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada perbantuan{includePast ? "" : " aktif atau mendatang"}.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terapis</TableHead>
                <TableHead>Outlet tujuan</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead className="hidden md:table-cell">Catatan</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.therapist_name}</TableCell>
                  <TableCell>{a.branch_name}</TableCell>
                  <TableCell>
                    {formatDate(a.start_date)} – {formatDate(a.end_date)}
                    {a.starts_at && a.ends_at && <p className="text-xs text-muted-foreground">{new Date(a.starts_at).toLocaleTimeString("id-ID", {timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit"})}–{new Date(a.ends_at).toLocaleTimeString("id-ID", {timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit"})} WIB</p>}
                    {a.start_date <= today && a.end_date >= today && (
                      <Badge variant="success" className="ml-2">
                        Berjalan
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[16rem] truncate md:table-cell">{a.note || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(a)}>
                      <Trash2 /> Batalkan
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {adding && <AssistDialog outlets={outlets} defaultBranch={branchId} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Batalkan perbantuan?"
        description={deleting ? `${deleting.therapist_name} di ${deleting.branch_name}, ${formatDate(deleting.start_date)} – ${formatDate(deleting.end_date)}.` : undefined}
        confirmLabel="Batalkan"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Perbantuan dibatalkan");
              setDeleting(null);
            },
            onError: (err) => toast.error("Perbantuan gagal dibatalkan", { description: err.message }),
          })
        }
      />
    </div>
  );
}

function AssistDialog({ outlets, defaultBranch, onClose }: { outlets: Outlet[]; defaultBranch: string; onClose: () => void }) {
  const [today] = useState(() => todayWib());
  const therapists = useSpaTherapists({ active: true });
  const [therapistId, setTherapistId] = useState("");
  const [branchId, setBranchId] = useState(defaultBranch || outlets.find((o) => o.configured)?.branch_id || "");
  const [start, setStart] = useState(() => new Date(Date.now()+7*3600000+60000).toISOString().slice(0,16));
  const [end, setEnd] = useState(`${today}T23:59`);
  const [startNow, setStartNow] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateAssist();
 const [impact,setImpact]=useState<Assist|null>(null);
 const [checking,setChecking]=useState(false);
  const therapist = (therapists.data ?? []).find((t) => t.id === therapistId);

  const submit = async () => {
    if (!therapistId) return setError("Pilih terapis.");
    if (!branchId) return setError("Pilih outlet tujuan.");
    if (therapist && therapist.home_branch_id === branchId) return setError("Outlet tujuan sama dengan outlet asal terapis.");
    if ((!startNow && !start) || !end || (!startNow && end <= start)) return setError("Tanggal selesai harus sama atau setelah tanggal mulai.");
    setError(null);
    const payload={ therapist_id: therapistId, branch_id: branchId, start_date: startNow ? todayWib() : start.slice(0,10), end_date: end.slice(0,10), ...(startNow ? {} : {starts_at: `${start}:00+07:00`}), ends_at: `${end}:00+07:00`, note: note.trim() };
    if (!impact) {setChecking(true);try {setImpact(await send<Assist>("/api/spa/assists/preview",payload));}catch(e){setError(e instanceof Error?e.message:"Validasi gagal");}finally{setChecking(false);}return;}
    create.mutate(
      payload,
      {
        onSuccess: () => {
          toast.success("Perbantuan ditambahkan", { description: therapist?.full_name });
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Perbantuan gagal disimpan", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah perbantuan</DialogPanelTitle>
            <DialogPanelDescription>Terapis berpindah sesuai jam efektif (WIB). Clock-in yang sudah tercatat tetap digunakan. Kuota harian kedua outlet, jadwal kerja, dan konflik booking diperiksa sebelum disimpan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody onChange={()=>setImpact(null)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Terapis" className="sm:col-span-2">
              <select className={SELECT} value={therapistId} onChange={(e) => setTherapistId(e.target.value)} required>
                <option value="">{therapists.isLoading ? "Memuat…" : "Pilih terapis…"}</option>
                {(therapists.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                    {t.home_branch_name ? ` (${t.home_branch_name})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Outlet tujuan" className="sm:col-span-2">
              <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} required />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={startNow} onChange={e=>setStartNow(e.target.checked)}/>Mulai saat perbantuan disimpan</label>
            <Field label="Mulai (WIB)">
              <Input type="datetime-local" disabled={startNow} value={start} onChange={(e) => setStart(e.target.value)} required />
            </Field>
            <Field label="Selesai (WIB)">
              <Input type="datetime-local" value={end} min={startNow ? undefined : start} onChange={(e) => setEnd(e.target.value)} required />
            </Field>
            <Field label="Catatan" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              {impact && <div className="mb-3 space-y-1 rounded-lg bg-success-soft p-3 text-xs"><p className="font-medium">Syarat terpenuhi. Dampak kuota harian:</p>{impact.impact?.map((row,i)=><p key={i}>{outlets.find(o=>o.branch_id===row.branch_id)?.branch_name??row.branch_id} · {row.date}: perempuan {row.before_female} → {row.female} (min. {row.min_female}), laki-laki {row.before_male} → {row.male} (min. {row.min_male})</p>)}<p>Kuota dihitung pada outlet dengan durasi tugas terpanjang; durasi sama dihitung di outlet asal. Absensi lama tetap tersimpan.</p></div>}
              <FormError>{error}</FormError>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending||checking}>
              Batal
            </Button>
            <Button type="submit" disabled={create.isPending||checking}>
              {create.isPending ? "Menyimpan…" : checking ? "Memeriksa…" : impact ? "Simpan perbantuan" : "Periksa perbantuan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

// ── Tab PIC Outlet ───────────────────────────────────────────────────────────

function PicsTab({ outlets }: { outlets: Outlet[] }) {
  const [branchId, setBranchId] = useState("");
  const pics = useSpaOutletPics(branchId || undefined);
  const remove = useDeleteOutletPic();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<OutletPic | null>(null);
  const rows = pics.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} allLabel="Semua outlet" />
        </div>
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          <Plus /> Tambah PIC
        </Button>
      </div>
      <Card className="py-0">
        {pics.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={3} rows={4} />
          </div>
        ) : pics.error ? (
          <TableNote tone="danger">{pics.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada PIC outlet.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Outlet</TableHead>
                <TableHead>PIC</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={`${p.branch_id}:${p.employee_id}`}>
                  <TableCell>{p.branch_name}</TableCell>
                  <TableCell className="font-medium">{p.full_name}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(p)}>
                      <Trash2 /> Batalkan
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {adding && <PicDialog outlets={outlets} defaultBranch={branchId} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus PIC outlet?"
        description={deleting ? `${deleting.full_name} tidak lagi menjadi PIC ${deleting.branch_name}.` : undefined}
        confirmLabel="Batalkan"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(
            { branch_id: deleting.branch_id, employee_id: deleting.employee_id },
            {
              onSuccess: () => {
                toast.success("PIC dihapus");
                setDeleting(null);
              },
              onError: (err) => toast.error("PIC gagal dihapus", { description: err.message }),
            }
          )
        }
      />
    </div>
  );
}

function PicDialog({ outlets, defaultBranch, onClose }: { outlets: Outlet[]; defaultBranch: string; onClose: () => void }) {
  const [branchId, setBranchId] = useState(defaultBranch || outlets.find((o) => o.configured)?.branch_id || "");
  const [employee, setEmployee] = useState<EmployeeCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateOutletPic();

  const submit = () => {
    if (!branchId) return setError("Pilih outlet.");
    if (!employee) return setError("Pilih karyawan.");
    setError(null);
    create.mutate(
      { branch_id: branchId, employee_id: employee.id },
      {
        onSuccess: () => {
          toast.success("PIC ditambahkan", { description: employee.full_name });
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("PIC gagal disimpan", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah PIC outlet</DialogPanelTitle>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <Field label="Outlet">
              <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} required />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">Karyawan</p>
              <EmployeeSearch selected={employee} onPick={setEmployee} />
            </div>
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
