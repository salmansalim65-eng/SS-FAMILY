import { initials, isImageIcon } from "@/lib/format";
import type { DashboardApp } from "@/lib/types";

const BOX = {
  lg: "size-16 sm:size-[4.5rem] rounded-[1.35rem] text-lg",
  md: "size-12 rounded-2xl text-sm",
  sm: "size-10 rounded-xl text-sm",
  xs: "size-7 rounded-lg text-[10px]",
};

// Padding around a logo, per size (a percentage would follow the parent's width).
const LOGO_PAD = { lg: "p-2", md: "p-1.5", sm: "p-1", xs: "p-0.5" };

export function AppGlyph({ app, size = "lg" }: { app: Pick<DashboardApp, "name" | "icon" | "color">; size?: keyof typeof BOX }) {
  const box = BOX[size];
  const label = app.icon?.trim() || initials(app.name);
  if (isImageIcon(app.icon)) {
    // Logos sit whole on a white tile, the way phone home screens show them.
    return (
      <span className={`${box} ${LOGO_PAD[size]} flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-sm ring-1 ring-black/5`}>
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
