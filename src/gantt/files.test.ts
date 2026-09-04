import { describe, expect, it } from 'vitest';
import { exportFilename } from './files';

describe('exportFilename', () => {
  it('swaps the project extension', () => {
    expect(exportFilename('progetto.gantt', 'csv')).toBe('progetto.csv');
    expect(exportFilename('Piano 2026.GANTT', 'png')).toBe('Piano 2026.png');
  });

  it('appends to a name carrying no extension', () => {
    expect(exportFilename('progetto', 'csv')).toBe('progetto.csv');
  });

  it('leaves a foreign extension alone rather than guessing at it', () => {
    expect(exportFilename('piano.v2', 'csv')).toBe('piano.v2.csv');
  });
});
