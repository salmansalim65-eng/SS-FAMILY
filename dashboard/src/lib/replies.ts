// Messages still to be answered, mostly shared from WhatsApp.

export type Reply = {
  id: string;
  sender: string;
  message: string;
  due: string | null;
  done: boolean;
  done_at: string | null;
  created_at: string;
};

export const REPLY_COLUMNS = "id, sender, message, due, done, done_at, created_at";
export const PENDING_SHARE_KEY = "dashboard:pending-share";

// WhatsApp's own lines when several messages are shared or copied:
//   "[16/11/2026, 10:15 am] Ahmed Ali: text"   (copy / share)
//   "16/11/2026, 10:15 - Ahmed Ali: text"      (chat export)
const LINE = /^\s*(?:\[[^\]\n]{4,40}\]\s*|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?:\s?[ap]\.?m\.?)?\s+-\s+)([^:\n]{1,60}):\s?/i;

/** The sender (when WhatsApp put one in) and the message without WhatsApp's date prefixes. */
export function parseShared(raw: string): { sender: string; message: string } {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .split("\n")
    .map((l) => {
      const m = l.match(LINE);
      return m ? { name: m[1].trim(), text: l.slice(m[0].length) } : { name: null, text: l };
    });
  const names = new Set(lines.flatMap((l) => (l.name ? [l.name] : [])));
  if (names.size === 1) return { sender: [...names][0], message: lines.map((l) => l.text).join("\n").trim() };
  // Several people in one share: each line keeps its name, and there is no single sender.
  return { sender: "", message: lines.map((l) => (l.name ? `${l.name}: ${l.text}` : l.text)).join("\n").trim() };
}
