import { SidebarLayout } from "@/components/app-sidebar";
import { CalendarEmbed } from "@/components/calendar-embed";
import { CalendarEvents } from "@/components/calendar-events";
import { FilesNotes } from "@/components/files-notes";
import { Header } from "@/components/header";
import { Notes } from "@/components/notes";
import { Reports, type CardMeta, type ProjectApp } from "@/components/reports";
import { SsTasks } from "@/components/ss-tasks";
import { getApps, getCards, getNotes, getSettings } from "@/lib/data";
import { SSTASKS_URL } from "@/lib/sstasks";
import { requireOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  // ?screen=day or ?screen=projects shows half the dashboard, for two monitors.
  const requested = (await searchParams).screen;
  const screen = requested === "day" || requested === "projects" ? requested : "all";

  const { supabase } = await requireOwner();
  const [apps, cards, settings, notes] = await Promise.all([
    getApps(supabase, { activeOnly: true }),
    getCards(supabase, { activeOnly: true }),
    getSettings(supabase),
    getNotes(supabase),
  ]);

  const projects = apps.filter((a) => a.category === "project");
  const personal = apps.filter((a) => a.category === "personal");
  // Cards name their project by key ("SS_FAMILY"); match icons by the same rule.
  const projectKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const color = Object.fromEntries(apps.map((a) => [projectKey(a.name), a.color]));
  const appByKey: Record<string, ProjectApp> = Object.fromEntries(
    apps.map((a) => [projectKey(a.name), { name: a.name, icon: a.icon, color: a.color, url: a.url }]),
  );
  const cardMeta: CardMeta[] = cards.map(({ id, project, title, link, format, higher_is_better }) => ({
    id,
    project,
    title,
    link,
    format,
    higher_is_better,
  }));

  return (
    <SidebarLayout groups={[projects, personal]}>
      <main className="w-full space-y-6 px-4 pb-10 sm:px-6">
        <Header screen={screen} />

        {/* The day at a glance: this week's schedule, to-do and notes side by side. */}
        {screen !== "projects" && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CalendarEvents
              slim
              fallback={settings.google_calendar_embed_url ? <CalendarEmbed src={settings.google_calendar_embed_url} /> : null}
            />
            <SsTasks appUrl={SSTASKS_URL} />
            <div className="min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-sm md:col-span-2 xl:col-span-1">
              <Notes initial={notes} column />
            </div>
          </div>
        )}

        {/* OneDrive files and OneNote pages, read only. */}
        {screen !== "projects" && <FilesNotes />}

        {screen !== "day" && (
          <Reports
            cards={cardMeta}
            currency={settings.currency}
            color={color}
            apps={appByKey}
            order={[...projects, ...personal].map((a) => projectKey(a.name))}
          />
        )}
      </main>
    </SidebarLayout>
  );
}
