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
