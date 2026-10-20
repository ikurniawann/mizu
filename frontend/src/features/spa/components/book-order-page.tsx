"use client";

import { useState, useSyncExternalStore } from "react";
import { CalendarDays, DoorOpen, List, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayWib } from "@/lib/dates";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";
import { cn } from "@/lib/utils";
import { useArrivalQueue, useSpaBoard, useSpaOutlets } from "../queries";
import { sortByStart } from "../rules";
import type { BoardItem } from "../types";
import { BookOrderCalendar, type CalendarSlot } from "./book-order-calendar";
import { BookOrderList } from "./book-order-list";
import { BookingCreateDialog } from "./booking-create-dialog";
import { BookingGroupCreateDialog } from "./booking-group-create-dialog";
import { BookingGroupDialog } from "./booking-group-dialog";
import { BookingDetailDialog } from "./booking-detail-page";
import { ArrivalQueuePanel } from "./arrival-queue";
import { RoomBoard } from "./room-board";
import { OutletSelect, SELECT, SPA_KICKER, TableNote } from "./shared";

function visible(items: BoardItem[]): BoardItem[] {
  return sortByStart(items.filter((i) => i.status !== "cancelled"));
}

type BoardView = "calendar" | "list" | "room";
const VIEWS: { value: BoardView; label: string; icon: typeof List }[] = [
  { value: "calendar", label: "Sheet", icon: CalendarDays },
  { value: "list", label: "Daftar", icon: List },
  { value: "room", label: "Room", icon: DoorOpen },
];

function isView(v: unknown): v is BoardView {
  return v === "calendar" || v === "list" || v === "room";
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
 * Spa → Book Order: papan harian satu outlet dengan tampilan sheet, daftar,
 * room. Antrian terintegrasi di Sheet.
 */
export function SpaBookOrderPage() {
  const [openedBookingId, setOpenedBookingId] = useState<string | null>(null);
  const [openedGroupId, setOpenedGroupId] = useState<string | null>(null);
  const outlets = useSpaOutlets();
  const configured = (outlets.data ?? []).filter((o) => o.configured);
  const [picked, setPicked] = useState("");
  const branchId = picked || configured[0]?.branch_id || "";
  const [date, setDate] = useState(() => todayWib());
  const board = useSpaBoard(branchId, date);
  const arrival = useArrivalQueue(branchId, date);
  const view = useSyncExternalStore(subscribeView, readView, () => "calendar" as BoardView);
  const [creating, setCreating] = useState<CalendarSlot | "blank" | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
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
        description="Papan harian per outlet: satu booking ditangani satu terapis untuk seluruh treatment. Diperbarui otomatis setiap 10 detik."
        actions={
          <>
            <Button variant="outline" onClick={() => { void board.refetch(); void arrival.refetch(); }} disabled={!branchId || board.isFetching || arrival.isFetching}>
              <RefreshCw className={cn(board.isFetching && "animate-spin")} /> Muat ulang
            </Button>
            <Button onClick={() => setCreating("blank")} disabled={configured.length === 0}>
              <Plus /> Booking baru
            </Button>
            <Button variant="outline" onClick={() => setCreatingGroup(true)} disabled={!branchId}>
              <Plus /> Booking bersama
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,16rem)_11rem_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,12rem)_10rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <OutletSelect outlets={outlets.data ?? []} value={branchId} onChange={setPicked} className={SELECT} />
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Tanggal" />
        <label className="min-w-0 space-y-1.5 text-sm font-medium">
          <span>Cari terapis</span>
          <Input type="search" value={therapistSearch} onChange={(e) => setTherapistSearch(e.target.value)} placeholder="Nama terapis…" aria-label="Cari terapis" />
        </label>
        <label className="min-w-0 space-y-1.5 text-sm font-medium">
          <span>Cari pelanggan</span>
          <Input type="search" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Nama pelanggan…" aria-label="Cari pelanggan Book Order" />
        </label>
        <Tabs className="min-w-0 justify-self-end sm:col-span-2 lg:col-span-4 xl:col-span-1" value={view} onValueChange={(v) => isView(v) && setBoardView(v)}>
          <TabsList aria-label="Tampilan">
            {VIEWS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {(therapistSearch || customerSearch) && <Button variant="outline" onClick={() => { setTherapistSearch(""); setCustomerSearch(""); }}>Reset pencarian</Button>}

      {searching && board.data && !board.isLoading && !board.error && (
        <p role="status" className="text-sm text-muted-foreground">
          {allItems.length ? `${allItems.length} booking ditampilkan.` : "Tidak ada booking yang cocok dengan pencarian."}
          {therapistQuery && " Pencarian terapis menyaring kolom terapis; booking belum ditugaskan tetap ditampilkan."}
        </p>
      )}

      {outlets.isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : configured.length === 0 ? (
        <Card className="py-0 shadow-none!">
          <TableNote>Belum ada outlet spa. Atur di menu Outlet Spa.</TableNote>
        </Card>
      ) : board.isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : board.error ? (
        <Card className="py-0 shadow-none!">
          <TableNote tone="danger">{board.error.message}</TableNote>
        </Card>
      ) : view === "calendar" ? (
        <div className="space-y-3">
        <ArrivalQueuePanel branchId={branchId} date={date} />
        <BookOrderCalendar
          date={date}
          openTime={outlet?.open_time}
          closeTime={outlet?.close_time}
          therapists={therapists}
          arrivalQueue={arrival.data?.branch_id === branchId && arrival.data.date === date ? arrival.data : undefined}
          unassigned={unassigned}
          onOpenItem={openBooking}
          onSlot={setCreating}
          unassignedEmptyMessage={customerQuery ? "Tidak ada pelanggan yang cocok di Belum ditugaskan." : undefined}
        />
        </div>
      ) : view === "list" ? (
        <BookOrderList items={allItems} onOpenItem={openBooking} />
      ) : view === "room" ? (
        <RoomBoard branchId={branchId} onOpenBooking={setOpenedBookingId} />
      ) : null}

      {openedBookingId && <BookingDetailDialog id={openedBookingId} onClose={() => setOpenedBookingId(null)} onOpenBooking={setOpenedBookingId} />}
      {openedGroupId && <BookingGroupDialog id={openedGroupId} onClose={() => setOpenedGroupId(null)} onOpenBooking={(id) => { setOpenedGroupId(null); setOpenedBookingId(id); }} />}
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
      {creatingGroup && <BookingGroupCreateDialog branchId={branchId} onClose={() => setCreatingGroup(false)} onCreated={setOpenedGroupId} />}
    </div>
  );
}
