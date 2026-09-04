import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelog';

describe('parseChangelog', () => {
  it('parses entries newest first, as declared', () => {
    const text = `# Changelog

## v1.1 — 2026-10-01

- Seconda voce.
- Un'altra voce.

## v1.0 — 2026-09-04

- Prima versione pubblica.
`;
    const entries = parseChangelog(text);
    expect(entries).toEqual([
      { version: 'v1.1', date: '2026-10-01', notes: ['Seconda voce.', "Un'altra voce."] },
      { version: 'v1.0', date: '2026-09-04', notes: ['Prima versione pubblica.'] },
    ]);
  });

  it('attaches bullets to the entry they follow', () => {
    const text = `## v2.0 — 2026-11-01

- Nota A.

## v1.0 — 2026-09-04

- Nota B.
- Nota C.
`;
    const entries = parseChangelog(text);
    expect(entries[0].notes).toEqual(['Nota A.']);
    expect(entries[1].notes).toEqual(['Nota B.', 'Nota C.']);
  });

  it('returns an empty array for empty or garbage text', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('just some\nrandom text\nwith no headings')).toEqual([]);
  });
});
