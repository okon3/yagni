/// <reference types="node" />
// Node types for this file alone: the stylesheet is read as data below, and a
// `?raw` import returns nothing for CSS under vitest. The app project stays on
// `vite/client` types, so app code cannot reach the filesystem.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_OPTIONS, DEFAULT_BAR_COLOR, needsDarkInk } from './colors';

function colorOf(label: string): string {
  const option = COLOR_OPTIONS.find((o) => o.label === label);
  if (!option) throw new Error(`no such colour option: ${label}`);
  return option.key;
}

describe('needsDarkInk', () => {
  it('picks dark ink for the palette\'s lightest tint', () => {
    // Rose is the palest tint shipped (OKLab L ~0.675) — white ink loses
    // contrast fast at this end, dark ink wins.
    expect(needsDarkInk(colorOf('Rose'))).toBe(true);
  });

  it('picks white ink for the palette\'s darkest tint', () => {
    // Green is the deepest tint shipped (OKLab L ~0.512) — dark-on-dark
    // would be close to unreadable, white wins comfortably.
    expect(needsDarkInk(colorOf('Green'))).toBe(false);
  });

  it('picks white ink for the default bar colour', () => {
    expect(needsDarkInk(DEFAULT_BAR_COLOR)).toBe(false);
  });

  it('picks whichever ink wins at the true extremes', () => {
    expect(needsDarkInk('#ffffff')).toBe(true);
    expect(needsDarkInk('#000000')).toBe(false);
  });
});

/**
 * The two floors `colors.ts` and docs/view.md state about the palette, pinned
 * over the shipped set rather than at hand-picked points: a rule asserted in a
 * comment and measured nowhere is how the first attempt shipped seven tints
 * that failed the dark row.
 *
 * Contrast is recomputed here from the WCAG definition instead of reusing the
 * module's own helper, so a bug in that helper cannot make the palette look
 * compliant. The surfaces and the badge's dark ink are read from `index.css`:
 * the ink that *decides* (`needsDarkInk`) and the ink that *paints*
 * (`--bar-fill-ink-dark`) are two literals, and nothing else would notice them
 * drifting apart.
 */
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function cssColors(name: string): string[] {
  const matches = css.matchAll(new RegExp(`--${name}:\\s*#([0-9a-f]{3,6})`, 'gi'));
  return [...matches].map(([, digits]) =>
    digits.length === 3 ? `#${[...digits].map((d) => d + d).join('')}` : `#${digits}`,
  );
}

function luminance(hex: string): number {
  const channel = (shift: number) => {
    const c = ((Number.parseInt(hex.slice(1), 16) >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

function contrast(hexA: string, hexB: string): number {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the shipped palette', () => {
  // Light scheme first, dark second — the order the two blocks are declared in.
  const [lightRow, darkRow] = cssColors('surface');
  const [paintedInk] = cssColors('bar-fill-ink-dark');

  it.each(COLOR_OPTIONS)('$label clears 3:1 against both chart rows', ({ key }) => {
    expect(contrast(key, lightRow)).toBeGreaterThanOrEqual(3);
    expect(contrast(key, darkRow)).toBeGreaterThanOrEqual(3);
  });

  it.each(COLOR_OPTIONS)('$label clears 4.5:1 against the ink it gets', ({ key }) => {
    const ink = needsDarkInk(key) ? paintedInk : '#ffffff';
    expect(contrast(key, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(COLOR_OPTIONS)('$label gets the better of the two inks', ({ key }) => {
    expect(needsDarkInk(key)).toBe(contrast(key, paintedInk) > contrast(key, '#ffffff'));
  });
});

describe('an unreadable fill', () => {
  it('keeps white ink rather than guessing a luminance', () => {
    // `agentApi` lets a script set a colour the file format's own gate would
    // refuse; near-black on a dark shorthand navy was invisible.
    expect(needsDarkInk('#036')).toBe(false);
    expect(needsDarkInk('rebeccapurple')).toBe(false);
  });
});
