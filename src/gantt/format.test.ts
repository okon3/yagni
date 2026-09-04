import { describe, expect, it } from 'vitest';
import { formatDays } from './format';

describe('formatDays', () => {
  it('prints a whole number of days without decimals', () => {
    expect(formatDays(1)).toBe('1');
    expect(formatDays(2)).toBe('2');
    expect(formatDays(9)).toBe('9');
  });

  it('keeps the fraction the editor can produce', () => {
    expect(formatDays(0.25)).toBe('0.25');
    expect(formatDays(0.5)).toBe('0.5');
    expect(formatDays(2.75)).toBe('2.75');
  });

  it('drops the trailing zero of a fraction that ends in one', () => {
    expect(formatDays(1.5)).toBe('1.5');
    expect(formatDays(4.1)).toBe('4.1');
  });

  it('shows nothing for a task with no effort at all', () => {
    expect(formatDays(0)).toBe('0');
  });

  it('hides the noise a rollup picks up from floating point', () => {
    // 0.25 + 0.5 in minutes and back is not exactly 0.75 on every axis.
    expect(formatDays(0.7500000000000001)).toBe('0.75');
    expect(formatDays(8.999999999999998)).toBe('9');
  });

  it('rounds a duration that no number of days divides evenly', () => {
    // Three tasks sharing one person for a day each: 8/3 working days.
    expect(formatDays(8 / 3)).toBe('2.67');
  });
});
