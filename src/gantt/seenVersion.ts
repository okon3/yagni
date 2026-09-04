/**
 * The last changelog version the user has seen, so an update can announce
 * itself once and then stay quiet.
 */

import type { DraftStorage } from './draft';

const SEEN_VERSION_KEY = 'yagni.seenVersion';

export function readSeenVersion(storage: DraftStorage | undefined): string | null {
  try {
    return storage?.getItem(SEEN_VERSION_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeSeenVersion(storage: DraftStorage | undefined, version: string): void {
  try {
    storage?.setItem(SEEN_VERSION_KEY, version);
  } catch {
    // Unlike the draft there is nothing stale to clear: worst case the
    // changelog announces itself once more next time.
  }
}

/**
 * Whether the changelog should open on its own: there is a latest version,
 * something was seen before, and it isn't this one. A first-ever visit (seen
 * is null) or an unparsed changelog (latest is undefined) both stay quiet.
 */
export function announces(seen: string | null, latest: string | undefined): boolean {
  return typeof latest === 'string' && typeof seen === 'string' && seen !== latest;
}
