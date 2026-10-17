"use client";

import { useState } from "react";
import type { DashboardCard } from "@/lib/types";
import { deleteCard, saveCard } from "./actions";
import { Field, Status, dangerBtn, ghostBtn, inputCls, primaryBtn, useAction } from "./ui";

const TYPE_LABEL: Record<DashboardCard["query_type"], string> = {
  count: "Count rows",
  sum: "Sum a column",
  rpc: "Call a function",
  placeholder: "Placeholder (sample numbers)",
};

export function CardsEditor({ cards }: { cards: DashboardCard[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const projects = [...new Set(cards.map((c) => c.project))];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button type="button" className={ghostBtn} onClick={() => setEditing("new")}>+ Add card</button>
      </div>
      {editing === "new" && <CardForm onDone={() => setEditing(null)} />}
      {projects.map((project) => (
        <div key={project} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{project}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            {cards
              .filter((c) => c.project === project)
              .map((card) => (
                <li key={card.id}>
                  <div className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium ${card.is_active ? "" : "text-muted line-through"}`}>{card.title}</p>
                      <p className="truncate text-xs text-muted">
                        {TYPE_LABEL[card.query_type]}
                        {card.table_name ? ` · ${card.table_name}` : ""}
                        {card.date_range !== "all" ? ` · ${card.date_range.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    <button type="button" className={ghostBtn} onClick={() => setEditing(editing === card.id ? null : card.id)}>
                      {editing === card.id ? "Close" : "Edit"}
                    </button>
                  </div>
                  {editing === card.id && (
                    <div className="border-t border-line p-3">
                      <CardForm card={card} onDone={() => setEditing(null)} />
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CardForm({ card, onDone }: { card?: DashboardCard; onDone: () => void }) {
  const save = useAction();
  const remove = useAction();
  const [type, setType] = useState<DashboardCard["query_type"]>(card?.query_type ?? "count");

  return (
    <form onSubmit={save.submit(saveCard, onDone)} className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <input type="hidden" name="id" value={card?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" hint="Matches the env variable prefix, e.g. RMI → RMI_SUPABASE_URL">
          <input name="project" required defaultValue={card?.project} placeholder="RMI" className={`${inputCls} uppercase`} />
        </Field>
        <Field label="Title">
          <input name="title" required defaultValue={card?.title} placeholder="Total students" className={inputCls} />
        </Field>
        <Field label="Query type">
          <select name="query_type" value={type} onChange={(e) => setType(e.target.value as DashboardCard["query_type"])} className={inputCls}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select name="format" defaultValue={card?.format ?? "number"} className={inputCls}>
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="percent">Percent</option>
          </select>
        </Field>

        {type !== "placeholder" && (
          <Field label={type === "rpc" ? "Function name" : "Table name"} hint={type === "rpc" ? "Returns a number or {\"value\": n, \"previous\": n}" : undefined}>
            <input name="table_name" defaultValue={card?.table_name ?? ""} className={`${inputCls} font-mono`} />
          </Field>
        )}
        {type === "sum" && (
          <Field label="Column to sum">
            <input name="value_column" defaultValue={card?.value_column ?? ""} placeholder="amount" className={`${inputCls} font-mono`} />
          </Field>
        )}
        {(type === "count" || type === "sum") && (
          <>
            <Field label="Date column" hint="Used for the period and the vs-last-month trend">
              <input name="date_column" defaultValue={card?.date_column ?? ""} placeholder="created_at" className={`${inputCls} font-mono`} />
            </Field>
            <Field label="Period (Asia/Karachi)">
              <select name="date_range" defaultValue={card?.date_range ?? "all"} className={inputCls}>
                <option value="all">All time (trend vs start of month)</option>
                <option value="today">Today (vs same day last month)</option>
                <option value="this_month">This month (vs last month)</option>
              </select>
            </Field>
          </>
        )}
        {type === "placeholder" && (
          <>
            <Field label="Sample value">
              <input name="sample_value" inputMode="decimal" defaultValue={card?.sample_value ?? ""} className={inputCls} />
            </Field>
            <Field label="Sample last month">
              <input name="sample_previous" inputMode="decimal" defaultValue={card?.sample_previous ?? ""} className={inputCls} />
            </Field>
          </>
        )}
      </div>

      {(type === "count" || type === "sum") && (
        <Field label="Filter (JSON)" hint='e.g. [{"column":"status","op":"eq","value":"active"}] — ops: eq neq gt gte lt lte is in like ilike'>
          <textarea
            name="filter"
            rows={2}
            defaultValue={card && card.filter.length ? JSON.stringify(card.filter) : ""}
            className={`${inputCls} font-mono`}
          />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Order">
          <input name="sort_order" type="number" defaultValue={card?.sort_order ?? 100} className={inputCls} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="higher_is_better" defaultChecked={card?.higher_is_better ?? true} className="size-4" />
          Higher is better
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={card?.is_active ?? true} className="size-4" />
          Show on dashboard
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={primaryBtn} disabled={save.pending}>{save.pending ? "Saving…" : card ? "Save" : "Add card"}</button>
        <button type="button" className={ghostBtn} onClick={onDone}>Cancel</button>
        {card && (
          <button
            type="button"
            className={`${dangerBtn} ml-auto`}
            disabled={remove.pending}
            onClick={() => confirm(`Delete “${card.title}”?`) && remove.exec(() => deleteCard(card.id), onDone)}
          >
            Delete
          </button>
        )}
      </div>
      <Status error={save.error ?? remove.error} />
    </form>
  );
}
