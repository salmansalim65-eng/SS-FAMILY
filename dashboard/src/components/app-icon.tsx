import { initials, isImageIcon } from "@/lib/format";
import type { DashboardApp } from "@/lib/types";

const BOX = {
  lg: "size-16 sm:size-[4.5rem] rounded-[1.35rem] text-lg",
  md: "size-12 rounded-2xl text-sm",
  sm: "size-10 rounded-xl text-sm",
};

export function AppGlyph({ app, size = "lg" }: { app: Pick<DashboardApp, "name" | "icon" | "color">; size?: keyof typeof BOX }) {
  const box = BOX[size];
  const label = app.icon?.trim() || initials(app.name);
  if (isImageIcon(app.icon)) {
    // Logos sit whole on a white tile, the way phone home screens show them.
    return (
      <span className={`${box} flex shrink-0 items-center justify-center overflow-hidden bg-white p-[12%] shadow-sm ring-1 ring-black/5`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={app.icon!} alt="" className="size-full object-contain" />
      </span>
    );
  }
  return (
    <span
      className={`${box} flex shrink-0 items-center justify-center overflow-hidden font-bold text-white shadow-sm`}
      style={{ background: `linear-gradient(145deg, ${app.color}, color-mix(in srgb, ${app.color} 70%, black))` }}
    >
      <span className={label.length > 3 ? "text-xs" : ""}>{label}</span>
    </span>
  );
}

/**
 * Icons for the top bar: groups side by side with a thin divider between
 * them, or stacked one row per group on phones.
 */
export function AppDock({ groups }: { groups: DashboardApp[][] }) {
  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) {
    return <p className="px-2 text-sm text-muted">No icons yet — add some in Settings.</p>;
  }
  return (
    <ul className="flex flex-col gap-2 md:w-max md:flex-row md:items-start md:gap-1">
      {nonEmpty.map((group, i) => (
        <li key={i} className="flex flex-col gap-2 md:flex-row md:items-start md:gap-1">
          {i > 0 && <span aria-hidden className="h-px w-full bg-line md:mx-1.5 md:mt-2 md:h-10 md:w-px" />}
          <ul className="flex flex-wrap items-start gap-1">
            {group.map((app) => (
              <li key={app.id}>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={app.name}
                  className="group flex w-[3.85rem] flex-col sm:w-[4.25rem] items-center gap-1.5 rounded-2xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="transition group-hover:-translate-y-0.5 group-active:scale-95">
                    <AppGlyph app={app} size="md" />
                  </span>
                  <span className="w-full truncate text-center text-[11px] font-medium leading-tight">{app.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
