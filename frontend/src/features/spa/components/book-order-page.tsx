"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarDays, LayoutGrid, List, Plus, RefreshCw, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayWib } from "@/lib/dates";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";
import { formatDateLong, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useItemAction } from "../mutations";
import { useSpaBoard, useSpaOutlets } from "../queries";
import { genderLabel, isBookingClosed, sortByStart } from "../rules";
import type { BoardItem, BoardTherapist } from "../types";
import { BoardItemDialog, type BoardItemFollowUp } from "./board-item-dialog";
import { BookOrderCalendar, type CalendarSlot } from "./book-order-calendar";
import { BookOrderList } from "./book-order-list";
import { BookingCreateDialog } from "./booking-create-dialog";
import { AssignTherapistDialog, RescheduleDialog } from "./item-dialogs";
import { ItemStatusBadge, OutletSelect, SELECT, SPA_KICKER, TableNote, TimeRange } from "./shared";

function visible(items: BoardItem[]): BoardItem[] {
  return sortByStart(items.filter((i) => i.status !== "cancelled"));
}

type BoardView = "calendar" | "cards" | "list";
const VIEWS: { value: BoardView; label: string; icon: typeof List }[] = [
  { value: "calendar", label: "Kalender", icon: CalendarDays },
  { value: "cards", label: "Kartu", icon: LayoutGrid },
  { value: "list", label: "Daftar", icon: List },
];

function isView(v: unknown): v is BoardView {
  return v === "calendar" || v === "cards" || v === "list";
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
  const outlets = useSpaOutlets();
  const configured = (outlets.data ?? []).filter((o) => o.configured);
  const [picked, setPicked] = useState("");
  const branchId = picked || configured[0]?.branch_id || "";
  const [date, setDate] = useState(() => todayWib());
  const board = useSpaBoard(branchId, date);
  const view = useSyncExternalStore(subscribeView, readView, () => "calendar" as BoardView);
  const [assigning, setAssigning] = useState<BoardItem | null>(null);
  const [rescheduling, setRescheduling] = useState<BoardItem | null>(null);
  const [opened, setOpened] = useState<BoardItem | null>(null);
  const [creating, setCreating] = useState<CalendarSlot | "blank" | null>(null);

  const unassigned = visible(board.data?.unassigned ?? []);
  const therapists = board.data?.therapists ?? [];
  const outlet = configured.find((o) => o.branch_id === branchId);
  const outletName = outlet?.branch_name ?? "";
  const allItems = [
    ...(board.data?.unassigned ?? []),
    ...therapists.flatMap((t) => t.items.map((i) => ({ ...i, therapist_name: i.therapist_name ?? t.therapist.full_name }))),
  ];

  const followUp = (item: BoardItem, kind: BoardItemFollowUp) => {
    setOpened(null);
    if (kind === "assign") setAssigning(item);
    else setRescheduling(item);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Book Order"
        description="Papan harian per outlet: treatment yang belum punya terapis dan jadwal tiap terapis. Diperbarui otomatis setiap 30 detik."
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

      {outlets.isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : configured.length === 0 ? (
        <Card className="py-0">
          <TableNote>Belum ada outlet spa. Atur di menu Outlet Spa.</TableNote>
        </Card>
      ) : board.isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : board.error ? (
        <Card className="py-0">
          <TableNote tone="danger">{board.error.message}</TableNote>
        </Card>
      ) : view === "calendar" ? (
        <BookOrderCalendar
          date={date}
          openTime={outlet?.open_time}
          closeTime={outlet?.close_time}
          therapists={therapists}
          unassigned={unassigned}
          onOpenItem={setOpened}
          onSlot={setCreating}
        />
      ) : view === "list" ? (
        <BookOrderList items={allItems} onOpenItem={setOpened} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <Card className="gap-3 self-start px-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Belum ditugaskan</h2>
              <Badge variant={unassigned.length ? "warning" : "muted"}>{unassigned.length}</Badge>
            </div>
            {unassigned.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Semua treatment sudah punya terapis.</p>
            ) : (
              <ul className="space-y-2">
                {unassigned.map((item) => (
                  <li key={item.id} className="rounded-2xl bg-surface-2 p-3">
                    <BoardItemBody item={item} />
                    <Button
                      size="sm"
                      className="mt-2 w-full"
                      disabled={isBookingClosed({ status: item.booking_status })}
                      onClick={() => setAssigning(item)}
                    >
                      Tugaskan terapis
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {therapists.length === 0 ? (
            <Card className="py-0">
              <TableNote>Tidak ada terapis yang bertugas di outlet ini pada tanggal tersebut.</TableNote>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {therapists.map((t) => (
                <TherapistColumn key={t.therapist.id} row={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {assigning && (
        <AssignTherapistDialog
          bookingId={assigning.booking_id}
          branchId={branchId}
          item={assigning}
          onClose={() => setAssigning(null)}
        />
      )}
      {rescheduling && (
        <RescheduleDialog bookingId={rescheduling.booking_id} item={rescheduling} onClose={() => setRescheduling(null)} />
      )}
      {opened && <BoardItemDialog item={opened} onClose={() => setOpened(null)} onFollowUp={(kind) => followUp(opened, kind)} />}
      {creating && (
        <BookingCreateDialog
          outlets={outlets.data ?? []}
          defaultBranchId={branchId}
          defaultScheduled={creating === "blank" ? undefined : `${date}T${creating.time}`}
          defaultTherapistId={creating === "blank" ? undefined : (creating.therapistId ?? undefined)}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}

function BoardItemBody({ item }: { item: BoardItem }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <TimeRange start={item.starts_at} end={item.ends_at} className="text-sm font-semibold" />
        <ItemStatusBadge status={item.status} />
      </div>
      <p className="text-sm font-medium">{item.customer_name}</p>
      <p className="text-xs text-muted-foreground">
        {item.treatment_name} — {item.variant_name} ·{" "}
        <Link href={`/dashboard/spa/bookings/${item.booking_id}`} className="font-mono text-brand-text hover:underline">
          {item.booking_code}
        </Link>
      </p>
    </div>
  );
}

function TherapistColumn({ row }: { row: BoardTherapist }) {
  const action = useItemAction();
  const items = visible(row.items);
  const t = row.therapist;
  const run = (item: BoardItem, kind: "start" | "complete") =>
    action.mutate(
      { bookingId: item.booking_id, itemId: item.id, input: { action: kind } },
      {
        onSuccess: () => toast.success(kind === "start" ? "Treatment dimulai" : "Treatment selesai", { description: `${t.full_name} · ${item.customer_name}` }),
        onError: (err) => toast.error(kind === "start" ? "Gagal memulai" : "Gagal menyelesaikan", { description: err.message }),
      }
    );

  return (
    <Card className={cn("gap-3 px-4", row.on_leave && "opacity-70")}>
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
          <Badge variant="muted">{items.length} tugas</Badge>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Belum ada tugas.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "rounded-2xl border border-border p-3",
                item.status === "in_treatment" && "border-accent-strong bg-accent/10",
                item.status === "completed" && "opacity-70"
              )}
            >
              <BoardItemBody item={item} />
              {!isBookingClosed({ status: item.booking_status }) && (item.status === "assigned" || item.status === "in_treatment") && (
                <div className="mt-2 flex gap-1">
                  {item.status === "assigned" && (
                    <Button size="xs" variant="soft" disabled={action.isPending} onClick={() => run(item, "start")}>
                      Mulai
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant={item.status === "in_treatment" ? "default" : "ghost"}
                    disabled={action.isPending}
                    onClick={() => run(item, "complete")}
                  >
                    Selesai
                  </Button>
                  <span className="ml-auto self-center text-[11px] text-muted-foreground">
                    {item.started_at ? `mulai ${formatTime(item.started_at)}` : ""}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
