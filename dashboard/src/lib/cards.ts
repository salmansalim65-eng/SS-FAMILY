import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectClient } from "@/lib/projects";
import { addMonths, karachiToday, monthRange, startOf, todayRange, type Range } from "@/lib/time";
import type { CardFilter, CardResult, DashboardCard } from "@/lib/types";

const TIMEOUT_MS = 10_000;
const PAGE = 1000;
const MAX_ROWS = 100_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function applyFilters(query: Query, filters: CardFilter[]): Query {
  for (const f of filters) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.column)) throw new Error(`Bad filter column "${f.column}"`);
    switch (f.op) {
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
      case "like":
      case "ilike":
        query = query[f.op](f.column, f.value);
        break;
      case "is":
        query = query.is(f.column, f.value as boolean | null);
        break;
      case "in":
        query = query.in(f.column, Array.isArray(f.value) ? f.value : [f.value]);
        break;
      default:
        throw new Error(`Unknown filter op "${(f as CardFilter).op}"`);
    }
  }
  return query;
}

function applyRange(query: Query, column: string | null, range: Range | null): Query {
  if (!range || !column) return query;
  if (range.from) query = query.gte(column, range.from);
  return query.lt(column, range.to);
}

/** The current period and the matching period one month earlier. */
function periods(card: DashboardCard): { current: Range | null; previous: Range | null } {
  const today = karachiToday();
  const lastMonth = addMonths(today, -1);
  switch (card.date_range) {
    case "today":
      return { current: todayRange(today), previous: todayRange(lastMonth) };
    case "this_month":
      return { current: monthRange(today), previous: monthRange(lastMonth) };
    default:
      // A running total: compare with where it stood at the start of this month.
      return {
        current: null,
        previous: card.date_column ? { to: startOf({ ...today, d: 1 }) } : null,
      };
  }
}

async function count(db: SupabaseClient, card: DashboardCard, range: Range | null) {
  let q: Query = db.from(card.table_name!).select("*", { count: "exact", head: true });
  q = applyRange(applyFilters(q, card.filter), card.date_column, range);
  const { count: n, error } = await q.abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return n ?? 0;
}

// Sums in pages rather than with PostgREST aggregates, which are off by default.
async function sum(db: SupabaseClient, card: DashboardCard, range: Range | null) {
  const col = card.value_column;
  if (!col) throw new Error("value_column is required for a sum card");
  let total = 0;
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q: Query = db.from(card.table_name!).select(col);
    q = applyRange(applyFilters(q, card.filter), card.date_column, range);
    const { data, error } = await q.range(from, from + PAGE - 1).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) throw new Error(error.message);
    for (const row of data as Record<string, unknown>[]) total += Number(row[col]) || 0;
    if (data.length < PAGE) break;
  }
  return total;
}

async function rpc(db: SupabaseClient, card: DashboardCard) {
  // A project can guard its dashboard functions with a shared secret,
  // passed as p_key when <PROJECT>_DASHBOARD_KEY is set.
  const key = process.env[`${card.project}_DASHBOARD_KEY`];
  const { data, error } = await db
    .rpc(card.table_name!, key ? { p_key: key } : undefined)
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  if (typeof data === "number" || typeof data === "string") return { value: Number(data), previous: null };
  const obj = (Array.isArray(data) ? data[0] : data) as { value?: unknown; previous?: unknown } | null;
  return {
    value: obj?.value == null ? null : Number(obj.value),
    previous: obj?.previous == null ? null : Number(obj.previous),
  };
}

async function compute(card: DashboardCard): Promise<{ value: number | null; previous: number | null }> {
  if (card.query_type === "placeholder") {
    // TODO: connect a real query — edit this card in Settings → Report cards.
    return { value: card.sample_value, previous: card.sample_previous };
  }
  if (!card.table_name) throw new Error("table_name is not set");

  const db = projectClient(card.project);
  if (card.query_type === "rpc") return rpc(db, card);

  const run = card.query_type === "sum" ? sum : count;
  const { current, previous } = periods(card);
  const [value, prev] = await Promise.all([
    run(db, card, current),
    previous ? run(db, card, previous) : Promise.resolve(null),
  ]);
  return { value, previous: prev };
}

/** Computes every card independently; one failure never affects the rest. */
export async function computeCards(cards: DashboardCard[]): Promise<CardResult[]> {
  const settled = await Promise.allSettled(cards.map(compute));
  const updatedAt = new Date().toISOString();
  return settled.map((s, i) => ({
    id: cards[i].id,
    isSample: cards[i].query_type === "placeholder",
    updatedAt,
    ...(s.status === "fulfilled"
      ? { value: s.value.value, previous: s.value.previous, error: null }
      : {
          value: null,
          previous: null,
          error: s.reason instanceof Error ? s.reason.message : "Failed to load",
        }),
  }));
}
