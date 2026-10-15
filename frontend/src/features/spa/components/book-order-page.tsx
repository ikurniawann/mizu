"use client";

import { useState, useSyncExternalStore, type DragEvent } from "react";
import { CalendarDays, DoorOpen, GripVertical, LayoutGrid, List, ListOrdered, Palette, Plus, RefreshCw, UserRoundX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayWib } from "@/lib/dates";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";
import { formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isDraggable } from "../calendar";
import { useSpaBoard, useSpaOutlets } from "../queries";
import { canEditDesign, genderLabel, isBookingClosed, sortByStart } from "../rules";
import type { BoardItem, BoardTherapist } from "../types";
import { BookOrderCalendar, type CalendarSlot } from "./book-order-calendar";
import { BookOrderList } from "./book-order-list";
import { BookingCreateDialog } from "./booking-create-dialog";
import { BookingDetailDialog } from "./booking-detail-page";
import { AssignTherapistDialog } from "./item-dialogs";
import { CaseThumb } from "./case-design/case-preview";
import { CaseDesignBadge } from "./case-design/case-design-card";
import { CaseDesignDialog } from "./case-design/case-design-dialog";
import { ArrivalQueuePanel } from "./arrival-queue";
import { RoomBoard } from "./room-board";
import { ItemStatusBadge, OutletSelect, SELECT, SPA_KICKER, TableNote, TimeRange } from "./shared";
import { BOOKING_DRAG_TYPE, useBookingDnd } from "./use-booking-dnd";

function visible(items: BoardItem[]): BoardItem[] {
  return sortByStart(items.filter((i) => i.status !== "cancelled"));
}

type BoardView = "calendar" | "cards" | "list" | "room" | "queue";
const VIEWS: { value: BoardView; label: string; icon: typeof List }[] = [
  { value: "calendar", label: "Kalender", icon: CalendarDays },
  { value: "cards", label: "Kartu", icon: LayoutGrid },
  { value: "list", label: "Daftar", icon: List },
  { value: "room", label: "Room", icon: DoorOpen },
  { value: "queue", label: "Antrian", icon: ListOrdered },
];

function isView(v: unknown): v is BoardView {
  return v === "calendar" || v === "cards" || v === "list" || v === "room" || v === "queue";
}

// Tampilan terakhir yang dipilih, disimpan per peramban; bawaan kalender.
const viewListeners = new Set<() => void>();
let memoryView: BoardView = "calendar";

function readView(): BoardView {
  const saved = readStorage(STORAGE_KEYS.spaBookOrderView);
  return isView(saved) ? saved : memoryView;
}

function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

function setBoardView(view: BoardView) {
  memoryView = view;
  writeStorage(STORAGE_KEYS.spaBookOrderView, view);
  viewListeners.forEach((l) => l());
}

/**
 * Spa → Book Order: papan harian satu outlet dalam tiga tampilan — kalender
 * per terapis (bawaan), kartu per terapis, dan daftar treatment.
 */
export function SpaBookOrderPage() {
  const [openedBookingId, setOpenedBookingId] = useState<string | null>(null);
  const outlets = useSpaOutlets();
  const configured = (outlets.data ?? []).filter((o) => o.configured);
  const [picked, setPicked] = useState("");
  const branchId = picked || configured[0]?.branch_id || "";
  const [date, setDate] = useState(() => todayWib());
  const board = useSpaBoard(branchId, date);
  const view = useSyncExternalStore(subscribeView, readView, () => "calendar" as BoardView);
  const [assigning, setAssigning] = useState<BoardItem | null>(null);
  const [designing, setDesigning] = useState<BoardItem | null>(null);
  const [creating, setCreating] = useState<CalendarSlot | "blank" | null>(null);
  const [therapistSearch, setTherapistSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const therapistQuery = therapistSearch.trim().toLocaleLowerCase("id");
  const customerQuery = customerSearch.trim().toLocaleLowerCase("id");
  const matchesCustomer = (item: BoardItem) => item.customer_name.toLocaleLowerCase("id").includes(customerQuery);
  const searching = !!(therapistQuery || customerQuery);

  const unassigned = visible(board.data?.unassigned ?? []).filter(matchesCustomer);
  const therapists = (board.data?.therapists ?? [])
    .filter((row) => row.therapist.full_name.toLocaleLowerCase("id").includes(therapistQuery))
    .map((row) => ({ ...row, items: row.items.filter(matchesCustomer) }));
  const outlet = configured.find((o) => o.branch_id === branchId);
  const outletName = outlet?.branch_name ?? "";
  const allItems = [
    ...unassigned,
    ...therapists.flatMap((t) => t.items.map((i) => ({ ...i, therapist_name: i.therapist_name ?? t.therapist.full_name }))),
  ];

  const openBooking = (item: BoardItem) => setOpenedBookingId(item.booking_id);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Book Order"
        description="Papan harian per toko: satu booking ditangani satu crew untuk seluruh layanan. Diperbarui otomatis setiap 30 detik."
        actions={
          <>
            <Button variant="outline" onClick={() => void board.refetch()} disabled={!branchId || board.isFetching}>
              <RefreshCw className={cn(board.isFetching && "animate-spin")} /> Muat ulang
            </Button>
            <Button onClick={() => setCreating("blank")} disabled={configured.length === 0}>
              <Plus /> Booking baru
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,16rem)_11rem_1fr_auto] sm:items-center">
        <OutletSelect outlets={outlets.data ?? []} value={branchId} onChange={setPicked} className={SELECT} />
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Tanggal" />
        <p className="text-sm text-muted-foreground">
          {outletName ? <span className="font-medium text-foreground">{outletName}</span> : null}
          {outletName ? " · " : ""}
          {formatDateLong(date)}
        </p>
        <Tabs value={view} onValueChange={(v) => isView(v) && setBoardView(v)}>
          <TabsList aria-label="Tampilan">
            {VIEWS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1.5 text-sm font-medium">
          <span>Cari crew</span>
          <Input type="search" value={therapistSearch} onChange={(e) => setTherapistSearch(e.target.value)} placeholder="Nama crew…" aria-label="Cari crew" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>Cari pelanggan</span>
          <Input type="search" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Nama pelanggan…" aria-label="Cari pelanggan Book Order" />
        </label>
        {(therapistSearch || customerSearch) && <Button variant="outline" onClick={() => { setTherapistSearch(""); setCustomerSearch(""); }}>Reset pencarian</Button>}
      </div>
      {searching && board.data && !board.isLoading && !board.error && (
        <p role="status" className="text-sm text-muted-foreground">
          {allItems.length ? `${allItems.length} booking ditampilkan.` : "Tidak ada booking yang cocok dengan pencarian."}
          {therapistQuery && " Pencarian crew menyaring kolom crew; booking belum ditugaskan tetap ditampilkan."}
        </p>
      )}

      {outlets.isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : configured.length === 0 ? (
        <Card className="py-0 shadow-none!">
          <TableNote>Belum ada toko experience. Atur di menu Toko Experience.</TableNote>
        </Card>
      ) : board.isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : board.error ? (
        <Card className="py-0 shadow-none!">
          <TableNote tone="danger">{board.error.message}</TableNote>
        </Card>
      ) : view === "calendar" ? (
        <BookOrderCalendar
          date={date}
          openTime={outlet?.open_time}
          closeTime={outlet?.close_time}
          therapists={therapists}
          unassigned={unassigned}
          onOpenItem={openBooking}
          onSlot={setCreating}
          unassignedEmptyMessage={customerQuery ? "Tidak ada pelanggan yang cocok di Belum ditugaskan." : undefined}
        />
      ) : view === "list" ? (
        <BookOrderList items={allItems} onOpenItem={openBooking} onDesign={setDesigning} />
      ) : view === "room" ? (
        <RoomBoard branchId={branchId} onOpenBooking={setOpenedBookingId} />
      ) : view === "queue" ? (
        <ArrivalQueuePanel branchId={branchId} date={date} />
      ) : (
        <BookOrderCards
          therapists={therapists}
          unassigned={unassigned}
          therapistQuery={therapistQuery}
          customerQuery={customerQuery}
          onOpenItem={openBooking}
          onAssign={setAssigning}
          onDesign={setDesigning}
        />
      )}

      {openedBookingId && <BookingDetailDialog id={openedBookingId} onClose={() => setOpenedBookingId(null)} />}
      {designing && (
        <CaseDesignDialog
          bookingId={designing.booking_id}
          item={designing}
          customerName={designing.customer_name}
          editable={canEditDesign({ status: designing.booking_status, payment_status: designing.payment_status ?? "unpaid" }, designing)}
          onClose={() => setDesigning(null)}
        />
      )}
      {assigning && (
        <AssignTherapistDialog
          bookingId={assigning.booking_id}
          branchId={branchId}
          item={assigning}
          onClose={() => setAssigning(null)}
        />
      )}
      {creating && (
        <BookingCreateDialog
          outlets={outlets.data ?? []}
          defaultBranchId={branchId}
          defaultScheduled={creating === "blank" ? undefined : `${date}T${creating.time}`}
          defaultTherapistId={creating === "blank" ? undefined : (creating.therapistId ?? undefined)}
          onClose={() => setCreating(null)}
          onCreated={setOpenedBookingId}
        />
      )}
    </div>
  );
}

function startBookingDrag(event: DragEvent, item: BoardItem) {
  if (!isDraggable(item)) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData(BOOKING_DRAG_TYPE, item.id);
  event.dataTransfer.effectAllowed = "move";
}

function BookOrderCards({
  therapists, unassigned, therapistQuery, customerQuery, onOpenItem, onAssign, onDesign,
}: {
  therapists: BoardTherapist[];
  unassigned: BoardItem[];
  therapistQuery: string;
  customerQuery: string;
  onOpenItem: (item: BoardItem) => void;
  onAssign: (item: BoardItem) => void;
  onDesign: (item: BoardItem) => void;
}) {
  const dnd = useBookingDnd(unassigned, therapists);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card
        role="complementary"
        aria-label="Belum ditugaskan"
        className={cn("gap-3 self-start px-4 shadow-none!", dnd.dropTarget === "unassigned" && "bg-accent/10 ring-2 ring-accent ring-inset")}
        onDragOver={(event) => dnd.onDragOver(event, "unassigned")}
        onDragLeave={(event) => dnd.onDragLeave(event, "unassigned")}
        onDrop={(event) => dnd.onDrop(event, null)}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Belum ditugaskan</h2>
          <Badge variant={unassigned.length ? "warning" : "muted"}>{unassigned.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Seret kartu ke crew untuk menugaskan; seret kembali ke sini untuk melepas crew.</p>
        {unassigned.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{customerQuery ? "Tidak ada pelanggan yang cocok di Belum ditugaskan." : "Semua booking sudah punya crew."}</p>
        ) : (
          <ul className="space-y-2">
            {unassigned.map((item) => (
              <li
                key={item.id}
                draggable={isDraggable(item)}
                onDragStart={(event) => startBookingDrag(event, item)}
                className={cn("rounded-2xl bg-surface-2 p-3", isDraggable(item) && "cursor-grab active:cursor-grabbing")}
              >
                <BoardItemBody item={item} onOpenItem={onOpenItem} onDesign={onDesign} />
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={item.assignment_locked || isBookingClosed({ status: item.booking_status })}
                  onClick={() => onAssign(item)}
                >
                  Tugaskan crew
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {therapists.length === 0 ? (
        <Card className="py-0 shadow-none!">
          <TableNote>{therapistQuery ? "Tidak ada crew yang cocok dengan pencarian." : "Tidak ada crew yang bertugas di toko ini pada tanggal tersebut."}</TableNote>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {therapists.map((row) => (
            <TherapistColumn key={row.therapist.id} row={row} onOpenItem={onOpenItem} onDesign={onDesign} dnd={dnd} />
          ))}
        </div>
      )}
      {dnd.confirmation}
    </div>
  );
}

function BoardItemBody({ item, onOpenItem, onDesign }: { item: BoardItem; onOpenItem: (item: BoardItem) => void; onDesign: (item: BoardItem) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <TimeRange start={item.starts_at} end={item.ends_at} className="text-sm font-semibold" />
        <span className="flex items-center gap-1">
          {isDraggable(item) && <GripVertical aria-hidden className="size-4 text-muted-foreground" />}
          <ItemStatusBadge status={item.status} />
        </span>
      </div>
      <p className="text-sm font-medium">{item.customer_name}</p>
      <p className="text-xs text-muted-foreground">
        {item.treatment_name} — {item.variant_name} ·{" "}
        <button type="button" onClick={() => onOpenItem(item)} className="font-mono text-brand-text hover:underline">
          {item.booking_code}
        </button>
      </p>
      {item.customizable && (
        <button
          type="button"
          onClick={() => onDesign(item)}
          className="mt-1 flex w-full items-center gap-2 rounded-xl bg-background/70 p-1.5 text-left transition hover:bg-background"
        >
          {item.design ? <CaseThumb design={item.design} className="w-7" /> : <Palette className="mx-1 size-5 text-warning" />}
          <span className="min-w-0 flex-1">
            <CaseDesignBadge design={item.design} />
            {item.design ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.design.model} · {item.design.background_name}</span> : null}
          </span>
        </button>
      )}
    </div>
  );
}

function TherapistColumn({ row, onOpenItem, onDesign, dnd }: {
  row: BoardTherapist;
  onOpenItem: (item: BoardItem) => void;
  onDesign: (item: BoardItem) => void;
  dnd: ReturnType<typeof useBookingDnd>;
}) {
  const items = visible(row.items);
  const t = row.therapist;

  return (
    <Card
      role="region"
      aria-label={`Crew ${t.full_name}`}
      className={cn("gap-3 px-4 shadow-none!", row.on_leave && "opacity-70", dnd.dropTarget === t.id && "bg-accent/10 ring-2 ring-accent ring-inset")}
      onDragOver={(event) => dnd.onDragOver(event, t.id)}
      onDragLeave={(event) => dnd.onDragLeave(event, t.id)}
      onDrop={(event) => dnd.onDrop(event, row)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{t.full_name}</p>
          <p className="text-xs text-muted-foreground">
            {genderLabel(t.gender)}
            {row.shift
              ? ` · ${row.shift.name} ${row.shift.start_time.slice(0, 5)}–${row.shift.end_time.slice(0, 5)}`
              : " · tanpa shift"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {row.on_leave && (
            <Badge variant="warning">
              <UserRoundX /> Cuti
            </Badge>
          )}
          <Badge variant="muted">{items.length} booking</Badge>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Belum ada tugas.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              draggable={isDraggable(item)}
              onDragStart={(event) => startBookingDrag(event, item)}
              className={cn(
                "rounded-2xl border border-border p-3",
                item.status === "in_treatment" && "border-blue-500 bg-blue-50",
                item.status === "completed" && "opacity-70",
                isDraggable(item) && "cursor-grab active:cursor-grabbing"
              )}
            >
              <BoardItemBody item={item} onOpenItem={onOpenItem} onDesign={onDesign} />
              <Button size="xs" variant="soft" className="mt-2" onClick={() => onOpenItem(item)}>Detail booking</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
