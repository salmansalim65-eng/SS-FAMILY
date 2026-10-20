import Link from "next/link";
import { getApps, getCards, getSettings } from "@/lib/data";
import { googleConnection } from "@/lib/google";
import { requireOwner } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppsEditor } from "./apps-editor";
import { CardsEditor } from "./cards-editor";
import { GoogleCalendarSettings } from "./google-calendar";
import { GeneralForm } from "./general-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { supabase, user } = await requireOwner();
  const [apps, cards, settings, google, params] = await Promise.all([
    getApps(supabase),
    getCards(supabase),
    getSettings(supabase),
    googleConnection(supabase).catch(() => null),
    searchParams,
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-fg">← Dashboard</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted">Signed in as {user.email}</p>
        </div>
        <ThemeToggle />
      </header>

      <SettingsBlock id="general" title="General">
        <GeneralForm settings={settings} />
      </SettingsBlock>

      <SettingsBlock id="calendar" title="Google Calendar" hint="Shows your week and upcoming events on the dashboard, and lets you add new ones.">
        <GoogleCalendarSettings connection={google} result={params.google} />
      </SettingsBlock>

      <SettingsBlock id="icons" title="Icons" hint="Drag ⠿ to reorder. Inactive icons are hidden from the dashboard.">
        <AppsEditor apps={apps} />
      </SettingsBlock>

      <SettingsBlock id="cards" title="Report cards" hint="Each project's Supabase keys live in server environment variables, e.g. RMI_SUPABASE_URL.">
        <CardsEditor cards={cards} />
      </SettingsBlock>
    </main>
  );
}

function SettingsBlock({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
