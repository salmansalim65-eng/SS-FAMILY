"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatAmount, formatValue, trend } from "@/lib/format";
import { TIME_ZONE } from "@/lib/time";
import type { CardFormat, CardResult } from "@/lib/types";
import { AppGlyph } from "./app-icon";
import { Section } from "./section";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export type CardMeta = {
  id: string;
  project: string;
  title: string;
  format: CardFormat;
  higher_is_better: boolean;
};

/** The icon a project's cards are grouped under, matched by project key. */
export type ProjectApp = { name: string; icon: string | null; color: string; url: string };

type ProjectState = { loading: boolean; error: string | null; results: Record<string, CardResult> };

/**
 * Each project's cards dressed like its own dashboard: SSA's green and
 * VISTA's teal header bands with centred capitals, RMI's gold band, MBL's
 * blue. Projects not listed keep the plain card.
 */
type Theme = { header: string; accent: string; caps?: boolean };
const THEMES: Record<string, Theme> = {
  SSA: { header: "#1f7a2c", accent: "#1f7a2c", caps: true },
  VISTA: { header: "#175c49", accent: "#175c49", caps: true },
  RMI: { header: "linear-gradient(90deg, #8f6c2f, #ad8c4e)", accent: "#9c7a3c" },
  MBL: { header: "linear-gradient(90deg, #0b6fb3, #1b95d8)", accent: "#0b80c8" },
};

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

export function Reports({
  cards,
  currency,
  color,
  order,
  apps = {},
}: {
  cards: CardMeta[];
  currency: string;
  color: Record<string, string>;
  apps?: Record<string, ProjectApp>;
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
      title="Projects"
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
      <div className="space-y-4">
        {projects.map((project) => {
          const ps = state[project];
          const app = apps[project];
          const theme = THEMES[project];
          const accent = theme?.accent ?? color[project] ?? "var(--accent)";
          return (
            <div
              key={project}
              className="space-y-2.5 rounded-2xl border border-line p-2.5 sm:p-3"
              style={{
                borderTop: `3px solid ${accent}`,
                background: `color-mix(in srgb, ${accent} 6%, var(--surface-2))`,
              }}
            >
              <h3 className="flex items-center gap-2.5 text-sm font-semibold">
                {app ? <AppGlyph app={app} size="xs" /> : <span className="size-2.5 rounded-full" style={{ background: accent }} />}
                <span className="truncate">{app?.name ?? project}</span>
                {ps?.loading && <span aria-hidden className="animate-spin text-xs text-muted">↻</span>}
                {updatedAt(ps) && <span className="text-[11px] font-normal text-muted">Updated {updatedAt(ps)}</span>}
                {app && (
                  <a href={app.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-normal text-muted hover:text-fg">
                    Open ↗
                  </a>
                )}
              </h3>
              {/* Small cards, as many to a row as fit (six on a laptop), so a project takes one or two rows. */}
              <div className="grid grid-cols-2 gap-2 sm:[grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
                {cards
                  .filter((c) => c.project === project)
                  .map((card) => (
                    <KpiCard
                      key={card.id}
                      theme={theme}
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

function updatedAt(ps: ProjectState | undefined) {
  const first = ps && Object.values(ps.results)[0];
  return first ? timeFmt.format(new Date(first.updatedAt)) : null;
}

function KpiCard({
  theme,
  card,
  result,
  loading,
  projectError,
  currency,
}: {
  theme?: Theme;
  card: CardMeta;
  result?: CardResult;
  loading: boolean;
  projectError: string | null;
  currency: string;
}) {
  const error = result?.error ?? (result ? null : projectError);
  const change = result ? trend(result.value, result.previous) : null;
  const detail = result?.detail;
  const display =
    result?.value == null
      ? "—"
      : detail?.unit || detail?.style || detail?.suffix
        ? formatAmount(result.value, detail.style, detail.unit, detail.suffix)
        : formatValue(result.value, card.format, currency);
  const amount = (v: number | null, suffix?: string, unit?: string) =>
    v == null ? "—" : formatAmount(v, detail?.style, unit ?? detail?.unit, suffix);
  const good = change == null ? null : change === 0 ? null : change > 0 === card.higher_is_better;

  return (
    <article
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface shadow-sm ${theme ? "" : "border-line p-2.5 sm:p-3"}`}
      style={theme ? { borderColor: `color-mix(in srgb, ${theme.accent} 35%, var(--line))` } : undefined}
      title={card.title}
    >
      {theme ? (
        <h4
          className={`line-clamp-1 px-2.5 py-1.5 text-[11px] font-semibold leading-tight text-white ${
            theme.caps ? "text-center uppercase tracking-wide" : ""
          }`}
          style={{ background: theme.header }}
        >
          {card.title}
        </h4>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-2 text-xs font-medium leading-tight text-muted">{card.title}</h4>
          {result?.isSample && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Sample</span>
          )}
        </div>
      )}
      <div className={theme ? "flex flex-1 flex-col p-2.5" : "contents"}>

      {loading ? (
        <div className="mt-2 space-y-2" aria-label="Loading">
          <div className="h-6 w-2/3 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      ) : error ? (
        <div className="mt-2 rounded-lg bg-danger-soft px-2 py-1.5 text-xs text-danger" role="alert">
          <p className="font-medium">Couldn’t load</p>
          <p className="mt-0.5 line-clamp-3 break-words opacity-90">{error}</p>
        </div>
      ) : (
        <>
          <p
            className={`mt-1 truncate font-semibold tabular-nums tracking-tight ${display.length > 14 ? "text-base" : "text-lg sm:text-xl"} ${
              detail?.tone === "up" ? "text-up" : detail?.tone === "down" ? "text-down" : ""
            }`}
          >
            {display}
          </p>
          {detail?.rows && detail.rows.length > 0 && (
            <dl className="mt-1.5 space-y-0.5 text-[11px] leading-snug">
              {detail.rows.map((r, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <dt className="truncate text-muted">{r.label}</dt>
                  <dd
                    className={`shrink-0 tabular-nums ${r.tone === "up" ? "text-up" : r.tone === "down" ? "text-down" : ""}`}
                  >
                    {r.plain ? (r.value == null ? "—" : formatAmount(r.value, "full", undefined, r.suffix)) : amount(r.value, r.suffix, r.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {detail?.progress != null && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2" aria-label={`${Math.round(detail.progress)}%`}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${detail.progress}%`, background: theme?.accent }} />
            </div>
          )}
          {detail?.note && !theme && <p className="mt-1 truncate text-[10px] text-muted">{detail.note}</p>}
          {change != null && (
            <p className="mt-1 text-[11px]">
              <span className={good == null ? "text-muted" : good ? "text-up" : "text-down"}>
                {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change).toFixed(1)}%
                <span className="text-muted"> vs last month</span>
              </span>
            </p>
          )}
        </>
      )}
      </div>
      {theme && detail?.note && !loading && !error && (
        <p
          className="truncate px-2.5 py-1 text-[10px] font-medium text-muted"
          style={{ background: `color-mix(in srgb, ${theme.accent} 10%, var(--surface))` }}
        >
          {detail.note}
        </p>
      )}
    </article>
  );
}
