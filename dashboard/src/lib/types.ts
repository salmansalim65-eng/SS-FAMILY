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
};

/** What the browser gets back for one card. */
export type CardResult = {
  id: string;
  value: number | null;
  previous: number | null;
  isSample: boolean;
  error: string | null;
  updatedAt: string;
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
