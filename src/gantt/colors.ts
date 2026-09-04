export const DEFAULT_BAR_COLOR = '#3b74d6';

/** dhtmlx select editors carry plain text, so the hex is the option key. */
export const COLOR_OPTIONS = [
  { key: DEFAULT_BAR_COLOR, label: 'Blu' },
  { key: '#2f9e6e', label: 'Verde' },
  { key: '#c9822b', label: 'Ambra' },
  { key: '#c0533f', label: 'Rosso' },
  { key: '#7a5bbd', label: 'Viola' },
  { key: '#3f7d8c', label: 'Petrolio' },
  { key: '#6b7280', label: 'Grigio' },
];

/**
 * Avatar colours, picked by name so the same person keeps the same colour
 * across sessions without storing one.
 *
 * Kept clear of the task palette above: an avatar must not read as a task
 * colour.
 */
const AVATAR_COLORS = [
  '#5b6ebd',
  '#2f8f7d',
  '#a4693f',
  '#a6486a',
  '#4f7ca3',
  '#7b5ea7',
  '#3f7d55',
  '#8a6b2f',
];

export function avatarColorOf(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * A resource id as a class token, carried by every row, bar and link that
 * person appears on, and by their lane in the load panel.
 *
 * Ids come from the file and may hold anything, a space included, which would
 * split into two class names. The escape is injective — the escape character
 * escapes itself — so two people can never land on the same class.
 */
export function resourceClass(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9-]/g, (char) => `_${char.charCodeAt(0).toString(16)}_`);
  return `gantt-res-${safe}`;
}

/** Up to two initials, so "Marta Rossi" reads as MR and "Marta" as M. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  return (words.length > 1 ? first + words[words.length - 1][0] : first).toUpperCase();
}

/**
 * Darkens a hex colour, for a border, an outline, or the flatter shade a
 * summary takes.
 *
 * Here rather than in the chart because the printable figure paints the same
 * bars: one rule for what a darker shade of a task's colour is.
 */
export function shade(hex: string, factor = 0.72): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * factor);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}
