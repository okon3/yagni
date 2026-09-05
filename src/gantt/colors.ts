export const DEFAULT_BAR_COLOR = '#3b74d6';

/**
 * One consumer: `TaskDialog`'s colour swatches (`App.tsx` passes this straight
 * through). The hex is stored as-is on the task — this array only supplies
 * the picker's options and their English labels.
 *
 * 14 tints, distinguished by hue *and* luminance (not hue alone) — the only
 * way to keep this many apart on a 12px bar, and it degrades gracefully for
 * colour-blind users (minimum CIEDE2000 ΔE00 across every pair: 13.87).
 * Every tint clears 3:1 (the WCAG non-text floor) against **both** chart row
 * backgrounds — white in light scheme, `#1b1e24` in dark — since the tint
 * itself never changes with the scheme. It does not additionally cap
 * lightness against a single fixed ink: `needsDarkInk` below picks whichever
 * of white or a near-black reads best on each tint, so a tint just has to
 * clear 4.5:1 against *one* of the two. `DEFAULT_BAR_COLOR` is first and
 * unchanged: it's what a save omits as "no colour" (`GanttChart.tsx`) and
 * what `planFigure.ts` falls back to, so moving it would silently repaint
 * every existing project.
 */
export const COLOR_OPTIONS = [
  { key: DEFAULT_BAR_COLOR, label: 'Blue' },
  { key: '#6a5db6', label: 'Indigo' },
  { key: '#a385d1', label: 'Lilac' },
  { key: '#9f2cdd', label: 'Purple' },
  { key: '#dc28af', label: 'Magenta' },
  { key: '#ca2164', label: 'Crimson' },
  { key: '#c6808b', label: 'Rose' },
  { key: '#db4824', label: 'Red' },
  { key: '#856432', label: 'Amber' },
  { key: '#939a19', label: 'Olive' },
  { key: '#33a92d', label: 'Lime' },
  { key: '#147b38', label: 'Green' },
  { key: '#23a49e', label: 'Teal' },
  { key: '#327585', label: 'Petrol' },
];

/**
 * Near-black, the same figure as `--on-accent`'s dark-mode ink
 * (`index.css`) — chosen for the same reason: white ink loses contrast
 * fast as a fill lightens, and a near-black (rather than a mid-grey) keeps
 * a badge legible right up to the point a tint is light enough for white to
 * fail, closing the gap between "white wins" and "dark wins" instead of
 * leaving tints in between illegible either way.
 */
const BADGE_DARK_INK = '#0a0c12';

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance (the basis of the 4.5:1/3:1 contrast ratios), or
 * null for anything that is not a `#rrggbb` colour.
 */
function relativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const r = srgbToLinear((value >> 16) & 255);
  const g = srgbToLinear((value >> 8) & 255);
  const b = srgbToLinear(value & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number | null {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Does a badge painted on this fill need dark ink instead of white?
 *
 * Answers by contrast, not by a fixed lightness threshold: computes both
 * options and returns whichever wins. Used for `seg-pct`, the allocation
 * badge that sits directly on a task's own colour (`segmentBar.ts`) — the
 * one place a bar's fill has to carry legible text, so the badge adapts
 * instead of the palette being capped to stay white-legible.
 */
export function needsDarkInk(fill: string): boolean {
  const onDark = contrastRatio(fill, BADGE_DARK_INK);
  const onWhite = contrastRatio(fill, '#ffffff');
  // A fill we cannot read keeps white, the ink every badge carried before this
  // adapted: a guessed luminance puts near-black on what may well be a dark
  // colour, and the agent API accepts hexes the file format's gate refuses.
  if (onDark === null || onWhite === null) return false;
  return onDark > onWhite;
}

/**
 * Avatar colours, picked by name so the same person keeps the same colour
 * across sessions without storing one.
 *
 * Kept clear of the wider task palette above: not a clean lightness or
 * chroma band (the task palette now spans both — some tints are pale,
 * some deep, to read on both chart backgrounds — so avatars overlap parts
 * of that range), but verified computationally: every avatar clears a
 * CIEDE2000 ΔE00 of 11.2 from every other avatar and 11.8 from every task
 * tint, on par with the tints' own 13.87 mutual floor — an avatar reads as
 * a person, never as a task's colour.
 */
const AVATAR_COLORS = [
  '#835854',
  '#895881',
  '#767c50',
  '#446a5b',
  '#ab7254',
  '#4f8c6e',
  '#737da5',
  '#a55f71',
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
