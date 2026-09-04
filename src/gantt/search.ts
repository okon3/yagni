/**
 * Finding a task by name.
 *
 * The plan is not filtered down to what matches, and that is the same argument
 * highlighting a person makes: a task pulled out of its tree is a name with no
 * plan around it, and its phase, its neighbours and what it runs alongside are
 * the reason anybody looked it up. A tree makes the choice worse — drop the
 * ancestors that do not match and the hierarchy goes, keep them and the filter
 * is showing rows that do not match. So the matches are marked and walked, and
 * nothing is hidden: there is no state to get out of.
 */

/**
 * A name reduced to what a query should match it on.
 *
 * Case and accents both go: somebody looking for "analisi" has to find
 * "Analisi", and somebody typing it without the accent has to find "Attività".
 */
export function searchKey(value: string): string {
  return value
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/** `key` is already through `searchKey`; an empty one matches nothing at all. */
export function matchesSearch(name: string, key: string): boolean {
  return key !== '' && searchKey(name).includes(key);
}

/** The next match in a ring, so the last one steps round to the first. */
export function wrapIndex(count: number, index: number, step: number): number {
  if (count <= 0) return -1;
  // Nothing focused is outside the ring rather than a place in it, so forward
  // means the first match and back means the last — the arithmetic below has
  // no honest answer from a position that does not exist.
  if (index < 0) return step < 0 ? count - 1 : 0;
  return (((index + step) % count) + count) % count;
}
