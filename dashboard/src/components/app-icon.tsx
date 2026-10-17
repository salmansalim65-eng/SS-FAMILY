import { initials, isImageIcon } from "@/lib/format";
import type { DashboardApp } from "@/lib/types";

export function AppGlyph({ app, size = "lg" }: { app: Pick<DashboardApp, "name" | "icon" | "color">; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-16 sm:size-[4.5rem] rounded-[1.35rem] text-lg" : "size-10 rounded-xl text-sm";
  const label = app.icon?.trim() || initials(app.name);
  return (
    <span
      className={`${box} flex shrink-0 items-center justify-center overflow-hidden font-bold text-white shadow-sm`}
      style={{ background: `linear-gradient(145deg, ${app.color}, color-mix(in srgb, ${app.color} 70%, black))` }}
    >
      {isImageIcon(app.icon) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={app.icon!} alt="" className="size-full object-cover" />
      ) : (
        <span className={label.length > 3 ? "text-xs" : ""}>{label}</span>
      )}
    </span>
  );
}

export function AppGrid({ apps, compact = false }: { apps: DashboardApp[]; compact?: boolean }) {
  if (apps.length === 0) {
    return <p className="text-sm text-muted">No icons yet — add some in Settings.</p>;
  }
  return (
    <ul className={`grid grid-cols-4 gap-x-2 gap-y-5 ${compact ? "lg:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-6 lg:grid-cols-8"}`}>
      {apps.map((app) => (
        <li key={app.id}>
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-2 rounded-2xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="transition group-hover:-translate-y-0.5 group-active:scale-95">
              <AppGlyph app={app} />
            </span>
            <span className="w-full truncate text-center text-xs font-medium sm:text-sm">{app.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
