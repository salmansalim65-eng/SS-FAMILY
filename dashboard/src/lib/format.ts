import type { CardFormat } from "@/lib/types";

export function formatValue(value: number, format: CardFormat, currency: string) {
  if (format === "percent") return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 1 }).format(value)}%`;
  if (format === "currency") {
    try {
      return new Intl.NumberFormat("en-PK", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
    } catch {
      return `${currency} ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(value)}`;
    }
  }
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value);
}

/**
 * An amount the way a project's own dashboard writes it: with its unit
 * ("Rs 45.79 lakh", "AED 172,046", "929K") and an optional Dr/Cr suffix.
 */
export function formatAmount(value: number, style: "full" | "lakh" | "compact" = "full", unit?: string, suffix?: string) {
  const n = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });
  const abs = Math.abs(value);
  let body: string;
  if (style === "lakh" && abs >= 100_000) {
    body = abs >= 10_000_000 ? `${(value / 10_000_000).toFixed(2)} crore` : `${(value / 100_000).toFixed(2)} lakh`;
  } else if (style === "compact" && abs >= 1000) {
    const [div, letter] = abs >= 1_000_000 ? [1_000_000, "M"] : [1000, "K"];
    const scaled = value / div;
    body = `${Math.abs(scaled) >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}${letter}`;
  } else {
    body = n.format(value);
  }
  return [unit, body, suffix].filter(Boolean).join(" ");
}

/** Percent change vs the previous period, or null when it can't be computed. */
export function trend(value: number | null, previous: number | null) {
  if (value == null || previous == null || previous === 0) return null;
  return ((value - previous) / Math.abs(previous)) * 100;
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function isImageIcon(icon: string | null | undefined) {
  return !!icon && /^(https?:\/\/|\/)/.test(icon);
}
