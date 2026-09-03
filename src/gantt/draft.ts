/**
 * The unsaved project, kept in `localStorage` so a reload cannot lose it.
 *
 * Only the project as it is now is persisted, never the undo stack: the stack
 * is fifty copies of the same thing, and the quota is a handful of megabytes
 * shared with everything else on the origin.
 *
 * A draft is never adopted on its own — the app asks first. Restoring silently
 * would mean a file opened from disk and then reloaded comes back as something
 * that is neither the file nor what the user last saw.
 */

/** How long the plan has to sit still before the draft is written. */
export const DRAFT_DELAY = 1000;

const DRAFT_KEY = 'yagni.draft.v1';

export interface Draft {
  filename: string;
  /** The project as `.gantt` text. */
  text: string;
  /** Epoch milliseconds, so the question can say when it was left. */
  savedAt: number;
}

/** The slice of `localStorage` used here, which is also all a test needs. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `localStorage`, or nothing when the browser refuses it.
 *
 * Reading the property itself throws when storage is disabled by policy or by
 * a private window, so this cannot be a plain reference.
 */
export function localDraftStorage(): DraftStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readDraft(storage: DraftStorage | undefined): Draft | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(DRAFT_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { filename, text, savedAt } = parsed as Partial<Draft>;
    // The text is parsed by the file reader like any other, so nothing here
    // validates the project itself — only that there is something to offer.
    if (typeof filename !== 'string' || filename.length === 0) return null;
    if (typeof text !== 'string' || text.length === 0) return null;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
    return { filename, text, savedAt };
  } catch {
    return null;
  }
}

export function writeDraft(storage: DraftStorage | undefined, draft: Draft): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Out of quota, or storage refused altogether. Whatever is in there is now
    // older than the plan on screen, and offering a stale draft as "the work
    // you did not save" is worse than offering none.
    clearDraft(storage);
  }
}

export function clearDraft(storage: DraftStorage | undefined): void {
  try {
    storage?.removeItem(DRAFT_KEY);
  } catch {
    // Nothing left to do: the draft is only ever offered, never trusted.
  }
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Local midnight, so "yesterday" is a calendar day and not 24 hours. */
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const DAY = 24 * 60 * 60 * 1000;

/**
 * When the draft was left, in the shortest form that is still unambiguous.
 *
 * The time alone would be read as today whatever day it is, and a full date
 * for something abandoned an hour ago reads as archaeology.
 */
export function draftAge(savedAt: number, now: Date): string {
  const when = new Date(savedAt);
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(when)) / DAY);
  if (days === 0) return `oggi ${time}`;
  if (days === 1) return `ieri ${time}`;
  const date = `${pad(when.getDate())}/${pad(when.getMonth() + 1)}`;
  return when.getFullYear() === now.getFullYear()
    ? `${date} ${time}`
    : `${date}/${when.getFullYear()} ${time}`;
}

/** The question the app asks before touching an unsaved draft. */
export function draftQuestion(draft: Draft, now: Date): string {
  return `Riprendo la bozza non salvata di «${draft.filename}» (${draftAge(draft.savedAt, now)})?`;
}
