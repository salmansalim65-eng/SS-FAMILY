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
