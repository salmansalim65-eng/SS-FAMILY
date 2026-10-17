"use client";

import type { Settings } from "@/lib/types";
import { saveGeneral } from "./actions";
import { Field, Status, inputCls, primaryBtn, useAction } from "./ui";

export function GeneralForm({ settings }: { settings: Settings }) {
  const { pending, error, saved, submit } = useAction();

  return (
    <form
      onSubmit={submit(saveGeneral)}
      className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" hint="Shown in the greeting">
          <input name="display_name" defaultValue={settings.display_name} className={inputCls} />
        </Field>
        <Field label="Currency" hint="3-letter code for money cards">
          <input name="currency" defaultValue={settings.currency} maxLength={3} className={`${inputCls} uppercase`} />
        </Field>
      </div>
      <Field
        label="Google Calendar embed URL"
        hint="Google Calendar → Settings → your calendar → Integrate calendar → copy the URL from “Embed code” (https://calendar.google.com/calendar/embed?src=…)."
      >
        <input
          name="google_calendar_embed_url"
          type="url"
          defaultValue={settings.google_calendar_embed_url ?? ""}
          placeholder="https://calendar.google.com/calendar/embed?src=…"
          className={inputCls}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button className={primaryBtn} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}
