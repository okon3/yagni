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
  people: [],
  rates: [1],
  contended: false,
  shared: false,
  disabled: false,
  chain: null,
  ...patch,
});

describe('renderBarTooltip', () => {
  it('answers what the bar is', () => {
    const html = renderBarTooltip(facts());
    expect(html).toContain('API di dominio');
    expect(html).toContain('Mon, 14/09/2026');
    expect(html).toContain('Mon, 21/09/2026');
    expect(html).toContain('3 d');
    expect(html).toContain('Marco');
  });

  it('escapes a name, since the tooltip is inserted as HTML', () => {
    const html = renderBarTooltip(facts({ name: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('prints the same day figures the grid does', () => {
    const html = renderBarTooltip(facts({ effortDays: 0.25, elapsedDays: 0.5 }));
    expect(html).toContain('0.25 d');
    expect(html).toContain('0.5 d');
    expect(html).not.toContain('0.50');
  });

  it('marks a duration that exceeds the effort, and only that one', () => {
    expect(renderBarTooltip(facts({ elapsedDays: 6 }))).toContain('gantt-stretched');
    expect(renderBarTooltip(facts())).not.toContain('gantt-stretched');
  });

  it('says the resource was split when it was', () => {
    const html = renderBarTooltip(facts({ elapsedDays: 6, rates: [0.5, 0.5], contended: true, shared: true }));
    expect(html).toContain('50%');
    expect(html).toContain('split with other tasks');
  });

  it('blames part-time rather than contention when nothing was split', () => {
    const html = renderBarTooltip(
      facts({ elapsedDays: 6, rates: [0.5], shared: true, resource: { name: 'Anna', availability: 0.5 } }),
    );
    expect(html).toContain('does not work full time');
    expect(html).not.toContain('split with other tasks');
    expect(html).toContain('at 50%');
  });

  it('shows the span of rates when the task changed regime', () => {
    expect(renderBarTooltip(facts({ rates: [1, 0.5, 0.33] }))).toContain('33%–100%');
  });

  it('says nothing about a quota it has no segments for', () => {
    // A task with no effort is never scheduled into segments, so there is no
    // rate to divide out of a zero-length span.
    const html = renderBarTooltip(facts({ effortDays: 0, elapsedDays: 0, rates: [] }));
    expect(html).not.toContain('Share');
    expect(html).toContain('0 d');
  });

  it('names neither a resource nor a quota on a summary', () => {
    const html = renderBarTooltip(
      facts({ isSummary: true, descendantCount: 4, resource: null, rates: [] }),
    );
    expect(html).not.toContain('Resource');
    expect(html).toContain('from its 4 subtasks');
  });

  it('agrees with itself about a single subtask', () => {
    const html = renderBarTooltip(facts({ isSummary: true, descendantCount: 1, rates: [] }));
    expect(html).toContain('from its subtask');
  });

  it('names everyone under a summary, past the faces the row can stack', () => {
    const html = renderBarTooltip(
      facts({
        isSummary: true,
        descendantCount: 6,
        resource: null,
        rates: [],
        people: [
          { name: 'Marco', availability: 1 },
          { name: 'Sara', availability: 0.5 },
          { name: 'Luca', availability: 1 },
          { name: 'Elena', availability: 1 },
          { name: 'Paolo', availability: 1 },
          { name: 'Giulia', availability: 1 },
        ],
      }),
    );
    expect(html).toContain('People');
    // The row shows four faces at most: the two the "+2" stands for are here.
    expect(html).toContain('Paolo');
    expect(html).toContain('Giulia');
    // Part-time reads the same as it does on a leaf.
    expect(html).toContain('Sara <em>at 50%</em>');
  });

  it('says person, not people, for a branch one person carries', () => {
    const html = renderBarTooltip(
      facts({ isSummary: true, resource: null, rates: [], people: [{ name: 'Marco', availability: 1 }] }),
    );
    expect(html).toContain('<dt>Person</dt>');
    expect(html).not.toContain('<dt>People</dt>');
  });

  it('escapes the names it lists, as it escapes the one it names', () => {
    const html = renderBarTooltip(
      facts({
        isSummary: true,
        resource: null,
        rates: [],
        people: [
          { name: '<img src=x onerror=alert(1)>', availability: 1 },
          { name: 'Sara', availability: 1 },
        ],
      }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('says nothing about people where a branch has none', () => {
    const html = renderBarTooltip(
      facts({ isSummary: true, resource: null, rates: [], people: [] }),
    );
    expect(html).toContain('<dt>People</dt><dd>&mdash;</dd>');
  });

  it('reports criticality only from a marking that exists', () => {
    expect(renderBarTooltip(facts())).not.toContain('Critical');
    const marked = renderBarTooltip(
      facts({ chain: { isCritical: true, contendedOn: null, stale: false } }),
    );
    expect(marked).toContain('Critical');
    expect(marked).not.toContain('before the last edit');
  });

  it('says a marking is old when the chart is drawing it dashed', () => {
    const html = renderBarTooltip(
      facts({ chain: { isCritical: true, contendedOn: null, stale: true } }),
    );
    expect(html).toContain('before the last edit');
  });

  it('says a disabled task does not weigh on the plan', () => {
    const html = renderBarTooltip(facts({ disabled: true }));
    expect(html).toContain('Disabled');
    expect(html).toContain('does not weigh on the plan');
  });

  it('says nothing about being disabled when it is not', () => {
    expect(renderBarTooltip(facts())).not.toContain('Disabled');
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
    expect(html).toContain('contended on Marco');
    expect(html).not.toContain('split with other tasks');
  });
});
