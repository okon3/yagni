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
