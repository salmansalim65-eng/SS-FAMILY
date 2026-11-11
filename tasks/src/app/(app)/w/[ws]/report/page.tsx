"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar, useAppData } from "@/components/data";
import { dmy } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";

type Report = {
  today: string;
  late: number;
  done_week: number;
  postponed_week: number;
  mudeer_id: string | null;
  mudeers: string[];
  can_set: boolean;
  people: { id: string; name: string; late: number; done_week: number; postponed_week: number }[];
  tasks: { id: string; title: string; project: string; project_id: string; due: string; days_late: number; postponed: number; can_open: boolean; people: string[] }[];
};

/** The Mudeer's follow-up report for one workspace (also sent every Monday in 🔔). */
export default function ReportPage() {
  const { ws } = useParams<{ ws: string }>();
  const { workspaces, members, people, reload } = useAppData();
  const workspace = workspaces.find((w) => w.id === ws);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("workspace_followup_report", { p_ws: ws });
    if (error) return setError(error.message);
    setError(null);
    setReport(data as Report);
  }, [ws]);

  useEffect(() => {
    load();
  }, [load]);

  async function chooseMudeer(userId: string) {
    const { error } = await supabase().rpc("set_workspace_mudeer", { p_ws: ws, p_user: userId || null });
    if (error) return alert(error.message);
    await Promise.all([load(), reload()]);
  }

  const candidates = members.filter((m) => m.workspace_id === ws && m.role !== "guest");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/w/${ws}`} className="text-sm text-muted hover:text-fg">
          ← {workspace?.name ?? "Workspace"}
        </Link>
        <h1 className="text-2xl font-semibold">Follow-up report</h1>
        {report && <span className="text-sm text-muted">as of {dmy(report.today)}</span>}
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
            <span className="font-medium">Mudeer</span>
            <span className="text-muted">— gets 7-days-late alerts and this report every Monday.</span>
            <div className="flex-1" />
            {report.can_set ? (
              <select value={report.mudeer_id ?? ""} onChange={(e) => chooseMudeer(e.target.value)} className="rounded-xl border border-line bg-surface px-2 py-1.5 text-sm">
                <option value="">Workspace owner</option>
                {candidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {people.get(m.user_id)?.full_name || people.get(m.user_id)?.email}
                  </option>
                ))}
              </select>
            ) : (
              <span className="flex items-center gap-1.5">
                {report.mudeers.map((id) => (
                  <span key={id} className="flex items-center gap-1">
                    <Avatar person={people.get(id)} size="xs" /> {people.get(id)?.full_name}
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Late now" value={report.late} tone="text-red-600 dark:text-red-400" />
            <Stat label="Done in the last 7 days" value={report.done_week} tone="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Due dates moved (7 days)" value={report.postponed_week} tone="text-amber-600 dark:text-amber-400" />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">By person</h2>
            {report.people.length === 0 ? (
              <p className="text-sm text-muted">No activity.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 font-medium">Person</th>
                      <th className="px-3 py-2 text-right font-medium">Late</th>
                      <th className="px-3 py-2 text-right font-medium">Done (7 days)</th>
                      <th className="px-3 py-2 text-right font-medium">Moved (7 days)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.people.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <Avatar person={people.get(p.id)} size="xs" /> {p.name}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${p.late ? "font-semibold text-red-600 dark:text-red-400" : "text-muted"}`}>{p.late}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.done_week}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${p.postponed_week ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}>{p.postponed_week}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Late tasks</h2>
            {report.tasks.length === 0 ? (
              <p className="text-sm text-muted">Nothing is late. 🎉</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {report.tasks.map((t) => {
                  const row = (
                    <>
                      <span
                        className={`w-16 shrink-0 rounded-lg px-1.5 py-1 text-center text-xs font-semibold ${
                          t.days_late >= 7 ? "bg-red-600 text-white" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        }`}
                      >
                        {t.days_late}d late
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        <span className="flex flex-wrap gap-x-2 text-xs text-muted">
                          <span>{t.project}</span>
                          <span>due {dmy(t.due)}</span>
                          {t.postponed > 0 && <span className="text-amber-600 dark:text-amber-400">↪ moved {t.postponed}×</span>}
                        </span>
                      </span>
                      <span className="hidden text-right text-xs text-muted sm:block">{t.people.join(", ")}</span>
                    </>
                  );
                  return (
                    <li key={t.id}>
                      {t.can_open ? (
                        <Link href={`/p/${t.project_id}?task=${t.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                          {row}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-3 py-2.5">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
