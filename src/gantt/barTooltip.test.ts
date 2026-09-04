import { describe, expect, it } from 'vitest';
import { renderBarTooltip, type BarFacts } from './barTooltip';

const facts = (patch: Partial<BarFacts> = {}): BarFacts => ({
  name: 'API di dominio',
  isSummary: false,
  descendantCount: 0,
  start: new Date(2026, 8, 14, 8, 0),
  end: new Date(2026, 8, 21, 17, 0),
  effortDays: 3,
  elapsedDays: 3,
  resource: { name: 'Marco', availability: 1 },
  rates: [1],
  contended: false,
  shared: false,
  chain: null,
  ...patch,
});

describe('renderBarTooltip', () => {
  it('answers what the bar is', () => {
    const html = renderBarTooltip(facts());
    expect(html).toContain('API di dominio');
    expect(html).toContain('lun 14/09/2026');
    expect(html).toContain('lun 21/09/2026');
    expect(html).toContain('3 g');
    expect(html).toContain('Marco');
  });

  it('escapes a name, since the tooltip is inserted as HTML', () => {
    const html = renderBarTooltip(facts({ name: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('prints the same day figures the grid does', () => {
    const html = renderBarTooltip(facts({ effortDays: 0.25, elapsedDays: 0.5 }));
    expect(html).toContain('0.25 g');
    expect(html).toContain('0.5 g');
    expect(html).not.toContain('0.50');
  });

  it('marks a duration that exceeds the effort, and only that one', () => {
    expect(renderBarTooltip(facts({ elapsedDays: 6 }))).toContain('gantt-stretched');
    expect(renderBarTooltip(facts())).not.toContain('gantt-stretched');
  });

  it('says the resource was split when it was', () => {
    const html = renderBarTooltip(facts({ elapsedDays: 6, rates: [0.5, 0.5], contended: true, shared: true }));
    expect(html).toContain('50%');
    expect(html).toContain('divisa con altre attività');
  });

  it('blames part-time rather than contention when nothing was split', () => {
    const html = renderBarTooltip(
      facts({ elapsedDays: 6, rates: [0.5], shared: true, resource: { name: 'Anna', availability: 0.5 } }),
    );
    expect(html).toContain('non lavora a tempo pieno');
    expect(html).not.toContain('divisa con altre attività');
    expect(html).toContain('al 50%');
  });

  it('shows the span of rates when the task changed regime', () => {
    expect(renderBarTooltip(facts({ rates: [1, 0.5, 0.33] }))).toContain('33%–100%');
  });

  it('says nothing about a quota it has no segments for', () => {
    // A task with no effort is never scheduled into segments, so there is no
    // rate to divide out of a zero-length span.
    const html = renderBarTooltip(facts({ effortDays: 0, elapsedDays: 0, rates: [] }));
    expect(html).not.toContain('Quota');
    expect(html).toContain('0 g');
  });

  it('names neither a resource nor a quota on a summary', () => {
    const html = renderBarTooltip(
      facts({ isSummary: true, descendantCount: 4, resource: null, rates: [] }),
    );
    expect(html).not.toContain('Risorsa');
    expect(html).toContain('dalle 4 sottoattività');
  });

  it('agrees with itself about a single subtask', () => {
    const html = renderBarTooltip(facts({ isSummary: true, descendantCount: 1, rates: [] }));
    expect(html).toContain('dalla sottoattività');
  });

  it('reports criticality only from a marking that exists', () => {
    expect(renderBarTooltip(facts())).not.toContain('Critica');
    const marked = renderBarTooltip(
      facts({ chain: { isCritical: true, contendedOn: null, stale: false } }),
    );
    expect(marked).toContain('Critica');
    expect(marked).not.toContain('prima dell’ultima modifica');
  });

  it('says a marking is old when the chart is drawing it dashed', () => {
    const html = renderBarTooltip(
      facts({ chain: { isCritical: true, contendedOn: null, stale: true } }),
    );
    expect(html).toContain('prima dell’ultima modifica');
  });

  it('names the contention once, in the line that explains the criticality', () => {
    const html = renderBarTooltip(
      facts({
        elapsedDays: 6,
        contended: true,
        shared: true,
        chain: { isCritical: true, contendedOn: 'Marco', stale: false },
      }),
    );
    expect(html).toContain('contesa su Marco');
    expect(html).not.toContain('divisa con altre attività');
  });
});
