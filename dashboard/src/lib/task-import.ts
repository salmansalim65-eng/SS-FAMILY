// Pasted text → task lists and their tasks, for "Import" in the Tasks panel.
//   # ERP            ← a list (made in Google Tasks if it doesn't exist)
//   - Stock report   ← a task in it (bullets, numbers and check boxes dropped)
// Lines before the first heading go to the default list.

export type ImportGroup = { list: string | null; titles: string[] };

export const IMPORT_MAX_TASKS = 300;

const BULLET = /^(?:[-*•◦▪●○☐☑✓✔✗]+|\[[ xX✓]?\]|\(?\d{1,3}[.)])\s*/;

export function parseTaskImport(text: string): ImportGroup[] {
  const groups: ImportGroup[] = [];
  let current: ImportGroup = { list: null, titles: [] };
  groups.push(current);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#+\s*(.+)$/);
    if (heading) {
      const name = heading[1].trim().slice(0, 100);
      if (!name) continue;
      const existing = groups.find((g) => g.list?.toLowerCase() === name.toLowerCase());
      current = existing ?? { list: name, titles: [] };
      if (!existing) groups.push(current);
      continue;
    }
    let title = line;
    for (let i = 0; i < 3 && BULLET.test(title); i++) title = title.replace(BULLET, "");
    title = title.trim().slice(0, 255);
    if (title) current.titles.push(title);
  }
  return groups.filter((g) => g.titles.length > 0 || g.list !== null);
}

export function importCount(groups: ImportGroup[]) {
  return groups.reduce((n, g) => n + g.titles.length, 0);
}
