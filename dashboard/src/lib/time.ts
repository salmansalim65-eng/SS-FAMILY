// Calendar helpers pinned to Asia/Karachi. Pakistan has no daylight saving,
// so a fixed +05:00 offset is exact.

export const TIME_ZONE = "Asia/Karachi";
const OFFSET = "+05:00";

export type Ymd = { y: number; m: number; d: number };

export function karachiToday(now = new Date()): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays({ y, m, d }: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Same day n months away, clamped to the end of a shorter month. */
export function addMonths({ y, m, d }: Ymd, n: number): Ymd {
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

/**
 * Midnight in Karachi, written with its offset. Works against both
 * timestamptz columns and plain date columns (Postgres keeps the date part).
 */
export function startOf({ y, m, d }: Ymd): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}T00:00:00${OFFSET}`;
}

export type Range = { from?: string; to: string };

export function todayRange(today: Ymd): Range {
  return { from: startOf(today), to: startOf(addDays(today, 1)) };
}

export function monthRange(today: Ymd): Range {
  const first = { ...today, d: 1 };
  return { from: startOf(first), to: startOf(addMonths(first, 1)) };
}
