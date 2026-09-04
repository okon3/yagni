import { describe, expect, it } from 'vitest';
import type { Resource } from '../scheduler';
import { planFigure, tickUnit } from './planFigure';
import { solve, type Project } from './project';

const people: Resource[] = [
  { id: 'r1', name: 'Marta Rossi', availability: 1 },
  { id: 'r2', name: 'Gino Bianchi', availability: 0.5 },
];

const calendar = {
  workingDays: [1, 2, 3, 4, 5],
  windows: [
    { from: 480, to: 720 },
    { from: 780, to: 1020 },
  ],
};

function figureOf(tasks: Project['tasks'], options?: Parameters<typeof planFigure>[2]) {
  const project: Project = { calendar, resources: people, tasks };
  return planFigure(project, solve(project), options);
}

const monday = new Date(2026, 8, 7, 8, 0);

/** The attributes of the one `<rect>`, `<polygon>` or `<text>` a matcher picks out. */
function attributes(svg: string, pattern: RegExp): Record<string, string> {
  const match = pattern.exec(svg);
  if (!match) throw new Error(`nothing matched ${pattern}`);
  const found: Record<string, string> = {};
  for (const [, name, value] of match[0].matchAll(/([a-z-]+)="([^"]*)"/g)) found[name] = value;
  return found;
}

describe('planFigure', () => {
  it('is one self-contained SVG: no stylesheet, no variable, no external reference', () => {
    const { svg } = figureOf([
      { id: '1', name: 'Analisi', nominalDays: 5, start: monday, resourceId: 'r1' },
    ]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('href');
  });

  it('grows with the plan rather than with a viewport', () => {
    const one = figureOf([{ id: '1', name: 'A', nominalDays: 1, start: monday }]);
    const many = figureOf(
      Array.from({ length: 40 }, (_, index) => ({
        id: String(index),
        name: `A${index}`,
        nominalDays: 1,
        start: monday,
      })),
    );
    expect(many.height - one.height).toBe(39 * 24);
    expect(many.width).toBe(one.width);
  });

  it('spans the timeline over the plan, closing day included', () => {
    // Monday to Friday at full rate: five day columns, so a fifth of the
    // timeline each.
    const { svg, width } = figureOf([
      { id: '1', name: 'Analisi', nominalDays: 5, start: monday, resourceId: 'r1' },
    ]);
    const bar = attributes(svg, /<rect x="[^"]+" y="[^"]+" width="[^"]+" height="12"[^/]*\/>/);
    const timelineLeft = 16 + 250 + 110;
    const pxPerDay = (width - 16 - timelineLeft) / 5;
    // 08:00 is a third of the way into the first column, 17:00 seven tenths into
    // the last: the same offsets the chart draws the bar between.
    expect(Number(bar.x)).toBeCloseTo(timelineLeft + pxPerDay * (8 / 24), 1);
    expect(Number(bar.x) + Number(bar.width)).toBeCloseTo(timelineLeft + pxPerDay * (4 + 17 / 24), 1);
  });

  it('draws a milestone as a diamond on the instant the schedule pinned it to', () => {
    const { svg, width } = figureOf([
      { id: '1', name: 'Analisi', nominalDays: 5, start: monday, resourceId: 'r1' },
      { id: '2', name: 'Consegna', nominalDays: 0, start: monday, predecessors: ['1'] },
    ]);
    const diamond = attributes(svg, /<polygon points="[^"]+" fill="[^"]+" \/>/);
    const timelineLeft = 16 + 250 + 110;
    const pxPerDay = (width - 16 - timelineLeft) / 5;
    // Friday 17:00, which is where Analisi closes and where the chart's diamond
    // sits — not Monday morning, the start constraint it was given.
    const expected = timelineLeft + pxPerDay * (4 + 17 / 24);
    const xs = diamond.points.split(' ').map((point) => Number(point.split(',')[0]));
    expect(Math.min(...xs)).toBeCloseTo(expected - 5.5, 1);
    expect(Math.max(...xs)).toBeCloseTo(expected + 5.5, 1);
  });

  it('draws a summary flatter than a leaf, and never as a milestone', () => {
    const { svg } = figureOf([
      { id: 'p', name: 'Fase', nominalDays: 0, start: monday },
      { id: 'm', name: 'Consegna', nominalDays: 0, start: monday, parentId: 'p' },
    ]);
    // The parent of a lone milestone has zero effort and start === end, and is
    // still a bracket over the row rather than a second diamond.
    expect(svg.match(/<polygon/g)).toHaveLength(1);
    expect(svg).toContain('height="8"');
  });

  it('carries the task colour, darkened on the summary above it', () => {
    const { svg } = figureOf([
      { id: 'p', name: 'Fase', nominalDays: 0, start: monday, color: '#2f9e6e' },
      { id: 'c', name: 'Foglia', nominalDays: 2, start: monday, resourceId: 'r1', parentId: 'p' },
    ]);
    // The leaf inherits its top-level ancestor's colour, as the chart's bars do.
    expect(svg).toContain('height="12" rx="6" fill="#2f9e6e"');
    expect(svg).toContain('height="8" rx="4" fill="#1a573d"');
  });

  it('shades the days nobody works, weekends and shutdowns alike', () => {
    const spanning = figureOf([
      { id: '1', name: 'Analisi', nominalDays: 8, start: monday, resourceId: 'r1' },
    ]);
    // Two weekend days inside the span, plus none outside it.
    expect(spanning.svg.match(/fill="#f5f6f9"/g)).toHaveLength(2);
  });

  it('prints the names, the people and the title, escaped', () => {
    const { svg } = figureOf(
      [{ id: '1', name: 'A & B <c>', nominalDays: 1, start: monday, resourceId: 'r2' }],
      { title: 'piano "2026".gantt' },
    );
    expect(svg).toContain('A &amp; B &lt;c&gt;');
    expect(svg).toContain('Gino Bianchi');
    expect(svg).toContain('piano &quot;2026&quot;.gantt');
    // Gino works half days, so one day of effort spans two of them.
    expect(svg).toContain('07/09/2026 → 08/09/2026');
  });

  it('truncates a name rather than letting it run into the timeline', () => {
    const { svg } = figureOf([
      { id: '1', name: 'A'.repeat(120), nominalDays: 1, start: monday },
    ]);
    expect(svg).toContain('…');
    expect(svg).not.toContain('A'.repeat(60));
  });

  it('draws today only when the plan covers it', () => {
    const inside = figureOf([{ id: '1', name: 'A', nominalDays: 5, start: monday }], {
      today: new Date(2026, 8, 9, 12, 0),
    });
    const outside = figureOf([{ id: '1', name: 'A', nominalDays: 5, start: monday }], {
      today: new Date(2026, 0, 9, 12, 0),
    });
    expect(inside.svg).toContain('#3b6fe0');
    expect(outside.svg).not.toContain('#3b6fe0');
  });

  it('holds a frame and a title for an empty plan instead of throwing', () => {
    const { svg } = figureOf([], { title: 'vuoto.gantt' });
    expect(svg).toContain('nessuna attività');
    expect(svg).not.toContain('<rect x=');
  });
});

describe('tickUnit', () => {
  it('climbs from days to weeks to months as the columns narrow', () => {
    expect(tickUnit(20)).toBe('day');
    expect(tickUnit(18)).toBe('day');
    expect(tickUnit(17)).toBe('week');
    expect(tickUnit(30 / 7)).toBe('week');
    expect(tickUnit(4)).toBe('month');
  });
});
