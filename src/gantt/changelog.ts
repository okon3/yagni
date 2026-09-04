export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string[];
}

const HEADING = /^##\s+(v\S+)\s+—\s+(\S+)/;
const BULLET = /^-\s+(.*)$/;

/**
 * Parses `CHANGELOG.md`'s own format: `## v<version> — <date>` headings
 * followed by `- ` bullets, in declared order. Never throws — a malformed or
 * empty document yields `[]`, and the caller shows nothing rather than crash.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = { version: heading[1], date: heading[2], notes: [] };
      entries.push(current);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet && current) {
      current.notes.push(bullet[1].trim());
    }
  }

  return entries;
}
