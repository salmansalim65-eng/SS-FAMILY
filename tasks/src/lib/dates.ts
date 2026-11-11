const TZ = "Asia/Karachi";
export const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export function addDaysKey(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "Today", "Tomorrow" or "12 Nov", with a tone for late / today. */
export function dueLabel(due: string, done = false) {
  const t = todayKey();
  const text = due === t ? "Today" : due === addDaysKey(t, 1) ? "Tomorrow" : fmt.format(new Date(`${due}T00:00:00Z`));
  const tone = done ? "text-muted" : due < t ? "text-danger" : due === t ? "text-accent" : "text-muted";
  return { text, tone, late: !done && due < t };
}
export function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return fmt.format(new Date(iso));
}
/** 2026-11-10 → 10/11/2026 */
export const dmy = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
/** Whole days from a due date to today (positive = late). */
export function daysLate(due: string) {
  return Math.round((Date.parse(`${todayKey()}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
}
