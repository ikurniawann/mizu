import { formatNumber } from "./format";

export function percentage(bookings: number, total: number) {
  return `${formatNumber(total ? bookings / total * 100 : 0, 1)}%`;
}

export function periodLabel(period: string, interval: "daily" | "monthly" | "yearly" = "daily") {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", year: "numeric",
    ...(interval !== "yearly" ? { month: "long" as const } : {}),
    ...(interval === "daily" ? { day: "numeric" as const } : {}),
  }).format(new Date(`${period}T00:00:00+07:00`));
}

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
