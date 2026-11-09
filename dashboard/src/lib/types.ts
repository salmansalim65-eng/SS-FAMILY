export type AppCategory = "project" | "personal";

export type DashboardApp = {
  id: string;
  name: string;
  url: string;
  icon: string | null;
  color: string;
  category: AppCategory;
  sort_order: number;
  is_active: boolean;
};

export type CardFormat = "number" | "currency" | "percent";
export type QueryType = "count" | "sum" | "rpc" | "placeholder";
export type DateRange = "all" | "today" | "this_month";

export type CardFilter = {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is" | "in" | "like" | "ilike";
  value: unknown;
};

export type DashboardCard = {
  id: string;
  project: string;
  title: string;
  query_type: QueryType;
  table_name: string | null;
  value_column: string | null;
  date_column: string | null;
  date_range: DateRange;
  filter: CardFilter[];
  format: CardFormat;
  sample_value: number | null;
  sample_previous: number | null;
  higher_is_better: boolean;
  sort_order: number;
  is_active: boolean;
  link: string | null; // path in the project's app, or a full URL
};

/** What the browser gets back for one card. */
/**
 * Extra detail an rpc card may return next to value/previous, so a card can
 * show what the project's own dashboard shows: a unit, Dr/Cr, sub-rows and a
 * progress bar. Every field is optional.
 */
export type CardDetail = {
  unit?: string; // "Rs", "AED", "SAR" — shown before amounts
  style?: "full" | "lakh" | "compact"; // 1,234,567 | 12.35 lakh | 1.2M
  suffix?: string; // after the main value, e.g. "Dr"
  tone?: "up" | "down"; // colours the main value
  // A row may carry its own unit when it is in another currency than the card.
  rows?: { label: string; value: number | null; suffix?: string; unit?: string; tone?: "up" | "down"; plain?: boolean }[];
  progress?: number; // 0–100
  note?: string;
};

export type CardResult = {
  id: string;
  value: number | null;
  previous: number | null;
  isSample: boolean;
  error: string | null;
  updatedAt: string;
  detail?: CardDetail;
};

export type Settings = {
  display_name: string;
  currency: string;
  google_calendar_embed_url: string | null;
};

/** One calendar event as the dashboard shows it. */
export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day events
  end: string;
  allDay: boolean;
  location: string | null;
  link: string | null;
  calendar: string;
  color: string | null;
};

export type NoteColor = "yellow" | "pink" | "green" | "blue" | "purple" | "orange";
export type ChecklistItem = { id: string; text: string; done: boolean };

export type Note = {
  id: string;
  kind: "text" | "checklist";
  title: string;
  body: string;
  items: ChecklistItem[];
  color: NoteColor;
  pinned: boolean;
  sort_order: number;
  updated_at: string;
};

export type TodoList = { id: string; name: string; isDefault: boolean };

export type TodoTask = {
  id: string;
  listId: string;
  listName: string;
  title: string;
  important: boolean;
  due: string | null; // YYYY-MM-DD, Asia/Karachi
  created: string | null;
  notes: string | null;
  done: boolean; // completed in the last week (shown under "Completed")
  color?: NoteColor | null; // kept by the dashboard, not the task service
  time?: string | null; // HH:MM on the due date, kept by the dashboard (Google Tasks keeps dates only)
};

/** What the task detail can change. */
export type TodoTaskEdit = { title: string; notes: string; due: string | null; time?: string | null };
