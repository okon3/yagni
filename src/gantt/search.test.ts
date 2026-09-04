import { describe, expect, it } from 'vitest';
import { matchesSearch, searchKey, wrapIndex } from './search';

describe('matchesSearch', () => {
  it('ignores case', () => {
    expect(matchesSearch('Analisi requisiti', searchKey('ANALISI'))).toBe(true);
    expect(matchesSearch('ANALISI', searchKey('analisi'))).toBe(true);
  });

  it('ignores accents in either direction', () => {
    expect(matchesSearch('Attività di test', searchKey('attivita'))).toBe(true);
    expect(matchesSearch('Attivita di test', searchKey('attività'))).toBe(true);
  });

  it('matches anywhere in the name, not only at the start', () => {
    expect(matchesSearch('Setup CI senza risorsa', searchKey('senza'))).toBe(true);
  });

  it('matches nothing on an empty query, so no row is marked before one is typed', () => {
    expect(matchesSearch('Analisi', searchKey(''))).toBe(false);
    expect(matchesSearch('Analisi', searchKey('   '))).toBe(false);
  });

  it('does not match a name that simply has nothing to do with it', () => {
    expect(matchesSearch('Analisi', searchKey('rilascio'))).toBe(false);
  });
});

describe('wrapIndex', () => {
  it('steps forward and back inside the list', () => {
    expect(wrapIndex(3, 0, 1)).toBe(1);
    expect(wrapIndex(3, 2, -1)).toBe(1);
  });

  it('rings round at either end', () => {
    expect(wrapIndex(3, 2, 1)).toBe(0);
    expect(wrapIndex(3, 0, -1)).toBe(2);
  });

  it('lands on the first match when nothing is focused yet', () => {
    expect(wrapIndex(3, -1, 1)).toBe(0);
  });

  it('lands on the last when stepping back from nothing focused', () => {
    expect(wrapIndex(3, -1, -1)).toBe(2);
  });

  it('has nowhere to go with no matches', () => {
    expect(wrapIndex(0, -1, 1)).toBe(-1);
  });
});
