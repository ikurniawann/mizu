"use client";

import { DoorOpen, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRoomBoard } from "../queries";
import { ROOM_CATEGORY_LABEL, ROOM_STATE_LABEL, ROOM_STATE_VARIANT } from "../rooms";
import type { RoomBoardEntry, RoomOccupant } from "../types";
import { Countdown } from "./countdown";
import { TableNote, TimeRange } from "./shared";

/** Spa → Book Order → tab Room: room mana yang terisi, siapa di dalamnya, dan sisa waktunya (revisi R6/R9). */
export function RoomBoard({ branchId, onOpenBooking }: { branchId: string; onOpenBooking: (bookingId: string) => void }) {
  const board = useRoomBoard(branchId);
  if (board.isLoading) return <Skeleton className="h-64 w-full rounded-card" />;
  if (board.error) {
    return (
      <Card className="py-0 shadow-none!">
        <TableNote tone="danger">{board.error.message}</TableNote>
      </Card>
    );
  }
  const rooms = board.data?.rooms ?? [];
  if (rooms.length === 0) {
    return (
      <Card className="py-0 shadow-none!">
        <TableNote>Belum ada room di outlet ini. Tambahkan di menu Room Spa.</TableNote>
      </Card>
    );
  }
  const occupied = rooms.filter((r) => r.state === "occupied").length;
  const free = rooms.filter((r) => r.state === "free").length;
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm text-muted-foreground">
        {occupied} terisi · {free} kosong dari {rooms.length} room. Diperbarui otomatis setiap 15 detik.
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => (
          <RoomCard key={room.id} room={room} onOpenBooking={onOpenBooking} />
        ))}
      </ul>
    </div>
  );
}

function RoomCard({ room, onOpenBooking }: { room: RoomBoardEntry; onOpenBooking: (bookingId: string) => void }) {
  const current = room.current;
  return (
    <li>
      <Card
        data-testid={`room-${room.id}`}
        className={cn(
          "gap-3 px-5",
          room.state === "occupied" && "ring-2 ring-accent-strong",
          room.state === "done" && "ring-2 ring-warning/60",
          room.state === "inactive" && "opacity-60",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-lg font-semibold">
              <DoorOpen className="size-5 text-muted-foreground" /> {room.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {ROOM_CATEGORY_LABEL[room.category]} · {room.capacity} orang{room.price_idr > 0 ? ` · Rp ${room.price_idr.toLocaleString("id-ID")}` : ""}
            </p>
          </div>
          <Badge variant={ROOM_STATE_VARIANT[room.state]}>{ROOM_STATE_LABEL[room.state]}</Badge>
        </div>
        {current ? (
          <Occupant occupant={current} running={room.state === "occupied"} onOpen={() => onOpenBooking(current.booking_id)} />
        ) : (
          <p className="text-sm text-muted-foreground">Tidak ada tamu di room ini.</p>
        )}
        {room.next && room.next.booking_id !== current?.booking_id && (
          <button
            type="button"
            onClick={() => onOpenBooking(room.next!.booking_id)}
            className="rounded-xl border border-dashed border-border px-3 py-2 text-left text-xs text-body hover:bg-surface"
          >
            Berikutnya: <span className="font-medium text-foreground">{room.next.customer_name}</span> · <TimeRange start={room.next.scheduled_at} end={room.next.ends_at} />
            {" · "}
            <span className="font-mono">{room.next.booking_code}</span>
          </button>
        )}
      </Card>
    </li>
  );
}

function Occupant({ occupant, running, onOpen }: { occupant: RoomOccupant; running: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="space-y-2 rounded-2xl bg-surface px-3 py-3 text-left hover:bg-surface-2">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <UserRound className="size-4 text-muted-foreground" /> {occupant.customer_name}
        </p>
        {running && occupant.started_at ? (
          <Countdown startedAt={occupant.started_at} durationMin={occupant.duration_min} />
        ) : (
          <span className="text-xs text-muted-foreground">
            <TimeRange start={occupant.scheduled_at} end={occupant.ends_at} />
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{occupant.booking_code}</span>
        {occupant.therapist_name ? ` · Terapis ${occupant.therapist_name}` : " · Terapis belum ditugaskan"}
      </p>
      {occupant.treatments.length > 0 && <p className="text-sm text-body">{occupant.treatments.join(", ")}</p>}
    </button>
  );
}
