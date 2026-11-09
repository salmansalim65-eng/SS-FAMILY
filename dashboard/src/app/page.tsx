import { AppDock } from "@/components/app-icon";
import { CalendarEmbed } from "@/components/calendar-embed";
import { CalendarEvents } from "@/components/calendar-events";
import { Header } from "@/components/header";
import { Notes } from "@/components/notes";
import { Reports, type CardMeta, type ProjectApp } from "@/components/reports";
import { Todos } from "@/components/todos";
import { getApps, getCards, getNotes, getSettings } from "@/lib/data";
import { requireOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
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
  const cardMeta: CardMeta[] = cards.map(({ id, project, title, format, higher_is_better }) => ({
    id,
    project,
    title,
    format,
    higher_is_better,
  }));

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 pb-10 sm:px-6">
      <Header>
        <AppDock groups={[projects, personal]} />
      </Header>

      {/* Three columns on wide screens: schedule | project cards | to-do and notes.
          On phones: schedule, to-do and notes, then the project cards. */}
      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)_19rem]">
        <aside className="min-w-0 lg:col-start-1 lg:row-start-1">
          <CalendarEvents
            slim
            fallback={settings.google_calendar_embed_url ? <CalendarEmbed src={settings.google_calendar_embed_url} /> : null}
          />
        </aside>

        <aside className="min-w-0 space-y-6 lg:col-start-3 lg:row-start-1">
          <Todos />
          <Notes initial={notes} column />
        </aside>

        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <Reports
            cards={cardMeta}
            currency={settings.currency}
            color={color}
            apps={appByKey}
            order={[...projects, ...personal].map((a) => projectKey(a.name))}
          />
        </div>
      </div>
    </main>
  );
}

