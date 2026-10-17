"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatValue, trend } from "@/lib/format";
import { TIME_ZONE } from "@/lib/time";
import type { CardFormat, CardResult } from "@/lib/types";
import { Section } from "./section";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export type CardMeta = {
  id: string;
  project: string;
  title: string;
  format: CardFormat;
  higher_is_better: boolean;
};

type ProjectState = { loading: boolean; error: string | null; results: Record<string, CardResult> };

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

export function Reports({
  cards,
  currency,
  color,
  order,
}: {
  cards: CardMeta[];
  currency: string;
  color: Record<string, string>;
  /** Project keys in icon order; projects not listed go last. */
  order: string[];
}) {
  const rank = (p: string) => (order.indexOf(p) + 1 || order.length + 1);
  const projects = [...new Set(cards.map((c) => c.project))].sort((a, b) => rank(a) - rank(b));
  const [state, setState] = useState<Record<string, ProjectState>>({});
  const projectsKey = projects.join(",");
  const busy = useRef(false);

  const loadProject = useCallback(async (project: string) => {
    setState((s) => ({ ...s, [project]: { results: s[project]?.results ?? {}, error: null, loading: true } }));
    try {
      const res = await fetch(`/api/cards?project=${encodeURIComponent(project)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const results: Record<string, CardResult> = {};
      for (const r of body.results as CardResult[]) results[r.id] = r;
      setState((s) => ({ ...s, [project]: { results, error: null, loading: false } }));
    } catch (e) {
      const error = e instanceof Error ? e.message : "Failed to load";
      setState((s) => ({ ...s, [project]: { results: s[project]?.results ?? {}, error, loading: false } }));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    // Each project loads on its own, so a slow or broken one doesn't hold up the rest.
    await Promise.allSettled(projectsKey.split(",").filter(Boolean).map(loadProject));
    busy.current = false;
  }, [projectsKey, loadProject]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const anyLoading = projects.some((p) => state[p]?.loading);

  return (
    <Section
      title="Reports"
      action={
        <button
          type="button"
          onClick={refresh}
          disabled={anyLoading}
          className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60"
        >
          <span aria-hidden className={anyLoading ? "animate-spin" : ""}>↻</span>
          {anyLoading ? "Refreshing" : "Refresh"}
        </button>
      }
    >
      {projects.length === 0 && <p className="text-sm text-muted">No report cards yet — add some in Settings.</p>}
      <div className="space-y-6">
        {projects.map((project) => {
          const ps = state[project];
          return (
            <div key={project} className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <span className="size-2.5 rounded-full" style={{ background: color[project] ?? "var(--accent)" }} />
                {project}
              </h3>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                {cards
                  .filter((c) => c.project === project)
                  .map((card) => (
                    <KpiCard
                      key={card.id}
                      card={card}
                      currency={currency}
                      result={ps?.results[card.id]}
                      loading={!ps || (ps.loading && !ps.results[card.id])}
                      projectError={ps?.error ?? null}
                    />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function KpiCard({
  card,
  result,
  loading,
  projectError,
  currency,
}: {
  card: CardMeta;
  result?: CardResult;
  loading: boolean;
  projectError: string | null;
  currency: string;
}) {
  const error = result?.error ?? (result ? null : projectError);
  const change = result ? trend(result.value, result.previous) : null;
  const display = result?.value == null ? "—" : formatValue(result.value, card.format, currency);
  const good = change == null ? null : change === 0 ? null : change > 0 === card.higher_is_better;

  return (
    <article className="flex min-h-32 min-w-0 flex-col rounded-2xl border border-line bg-surface p-3 shadow-sm sm:min-h-36 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs text-muted sm:text-sm">{card.title}</h4>
        {result?.isSample && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Sample</span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2" aria-label="Loading">
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      ) : error ? (
        <div className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
          <p className="font-medium">Couldn’t load</p>
          <p className="mt-0.5 line-clamp-3 break-words opacity-90">{error}</p>
        </div>
      ) : (
        <>
          <p className={`mt-2 break-words font-semibold tabular-nums tracking-tight ${display.length > 11 ? "text-base sm:text-2xl" : "text-xl sm:text-3xl"}`}>
            {display}
          </p>
          <p className="mt-1 text-xs">
            {change == null ? (
              <span className="text-muted">No comparison</span>
            ) : (
              <span className={good == null ? "text-muted" : good ? "text-up" : "text-down"}>
                {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change).toFixed(1)}%
                <span className="text-muted"> vs last mo<span className="hidden sm:inline">nth</span></span>
              </span>
            )}
          </p>
        </>
      )}

      <p className="mt-auto pt-3 text-[11px] text-muted">
        {result ? `Updated ${timeFmt.format(new Date(result.updatedAt))}` : " "}
      </p>
    </article>
  );
}
