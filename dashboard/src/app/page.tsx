import { AppGrid } from "@/components/app-icon";
import { CalendarEmbed } from "@/components/calendar-embed";
import { CalendarEvents } from "@/components/calendar-events";
import { Header } from "@/components/header";
import { Notes } from "@/components/notes";
import { Reports, type CardMeta } from "@/components/reports";
import { Section } from "@/components/section";
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
  const cardMeta: CardMeta[] = cards.map(({ id, project, title, format, higher_is_better }) => ({
    id,
    project,
    title,
    format,
    higher_is_better,
  }));

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-6 sm:px-6 sm:py-10">
      <Header name={settings.display_name} />

      <Section title="My Projects">
        <AppGrid apps={projects} />
      </Section>

      <Notes initial={notes} />

      <Reports cards={cardMeta} currency={settings.currency} color={color} order={[...projects, ...personal].map((a) => projectKey(a.name))} />

      <Section title="Personal">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <AppGrid apps={personal} compact />
          </div>
          <CalendarEvents
            fallback={settings.google_calendar_embed_url ? <CalendarEmbed src={settings.google_calendar_embed_url} /> : null}
          />
        </div>
      </Section>
    </main>
  );
}

