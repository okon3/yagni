import { describe, expect, it } from 'vitest';
import type { DraftStorage } from './draft';
import { announces, readSeenVersion, writeSeenVersion } from './seenVersion';

function fakeStorage(failing = false): DraftStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const fail = () => {
    throw new Error('storage refused');
  };
  return {
    entries,
    getItem: failing ? fail : (key) => entries.get(key) ?? null,
    setItem: failing ? fail : (key, value) => void entries.set(key, value),
    removeItem: failing ? fail : (key) => void entries.delete(key),
  };
}

describe('the last seen version', () => {
  it('round-trips what it was given', () => {
    const storage = fakeStorage();
    writeSeenVersion(storage, 'v1.2');
    expect(readSeenVersion(storage)).toBe('v1.2');
  });

  it('is null when nothing was ever recorded', () => {
    expect(readSeenVersion(fakeStorage())).toBeNull();
  });

  it('works as nothing seen when there is no storage', () => {
    expect(readSeenVersion(undefined)).toBeNull();
    expect(() => writeSeenVersion(undefined, 'v1.2')).not.toThrow();
  });

  it('does not throw when storage refuses every call', () => {
    const storage = fakeStorage(true);
    expect(readSeenVersion(storage)).toBeNull();
    expect(() => writeSeenVersion(storage, 'v1.2')).not.toThrow();
  });
});

describe('deciding whether to announce', () => {
  it('stays quiet on a first-ever visit, nothing seen yet', () => {
    expect(announces(null, 'v1.1')).toBe(false);
  });

  it('stays quiet when the seen version matches the latest', () => {
    expect(announces('v1.1', 'v1.1')).toBe(false);
  });

  it('announces when the seen version is older', () => {
    expect(announces('v1.0', 'v1.1')).toBe(true);
  });

  it('stays quiet when the changelog has no entries at all', () => {
    expect(announces('v1.0', undefined)).toBe(false);
  });
});
