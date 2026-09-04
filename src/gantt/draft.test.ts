import { describe, expect, it } from 'vitest';
import {
  clearDraft,
  draftAge,
  draftQuestion,
  readDraft,
  writeDraft,
  type Draft,
  type DraftStorage,
} from './draft';

function fakeStorage(failOnWrite = false): DraftStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (failOnWrite) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      entries.set(key, value);
    },
    removeItem: (key) => void entries.delete(key),
  };
}

const draft: Draft = { filename: 'progetto.gantt', text: '{"format":"x"}', savedAt: 1_700_000_000_000 };

describe('the autosaved draft', () => {
  it('round-trips what it was given', () => {
    const storage = fakeStorage();
    writeDraft(storage, draft);
    expect(readDraft(storage)).toEqual(draft);
    clearDraft(storage);
    expect(readDraft(storage)).toBeNull();
  });

  it('works as no draft at all when there is no storage', () => {
    expect(readDraft(undefined)).toBeNull();
    expect(() => writeDraft(undefined, draft)).not.toThrow();
    expect(() => clearDraft(undefined)).not.toThrow();
  });

  it('drops what it cannot replace when the quota is exhausted', () => {
    const storage = fakeStorage();
    writeDraft(storage, draft);
    const full = { ...storage, setItem: fakeStorage(true).setItem };
    expect(() => writeDraft(full, { ...draft, text: 'newer' })).not.toThrow();
    // A draft older than the plan on screen is worse than none.
    expect(readDraft(storage)).toBeNull();
  });

  it('refuses anything that is not a draft', () => {
    const storage = fakeStorage();
    for (const stored of [
      'not json',
      '[]',
      '{}',
      JSON.stringify({ ...draft, text: '' }),
      JSON.stringify({ ...draft, filename: 42 }),
      JSON.stringify({ ...draft, savedAt: 'ieri' }),
    ]) {
      storage.entries.set('yagni.draft.v1', stored);
      expect(readDraft(storage)).toBeNull();
    }
  });
});

describe('saying when the draft was left', () => {
  const now = new Date(2026, 8, 3, 9, 30);

  it('counts calendar days rather than hours', () => {
    expect(draftAge(new Date(2026, 8, 3, 0, 5).getTime(), now)).toBe('today 00:05');
    expect(draftAge(new Date(2026, 8, 2, 18, 42).getTime(), now)).toBe('yesterday 18:42');
    expect(draftAge(new Date(2026, 8, 1, 8, 0).getTime(), now)).toBe('01/09 08:00');
  });

  it('adds the year only when it is not this one', () => {
    expect(draftAge(new Date(2025, 11, 24, 17, 5).getTime(), now)).toBe('24/12/2025 17:05');
  });

  it('names the file it belongs to', () => {
    expect(draftQuestion({ ...draft, savedAt: new Date(2026, 8, 2, 18, 42).getTime() }, now)).toBe(
      'Resume the unsaved draft of "progetto.gantt" (yesterday 18:42)?',
    );
  });
});
