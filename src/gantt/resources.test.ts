import { describe, expect, it } from 'vitest';
import type { AvailabilityOverride, Resource } from '../scheduler';
import {
  nextResourceId,
  releasedBy,
  validateResources,
  withAvailability,
  withResourceAdded,
  withResourceRemoved,
  withResourceUpdated,
} from './resources';

const person = (id: string, name: string, availability = 1): Resource => ({
  id,
  name,
  availability,
});

describe('validateResources', () => {
  it('accepts a plain list', () => {
    expect(validateResources([person('r1', 'Marta'), person('r2', 'Bruno', 0.5)])).toBeNull();
  });

  it('refuses a person with no name', () => {
    expect(validateResources([person('r1', '   ')])).toBe('Every person needs a name');
  });

  it('refuses a duplicate name whatever its case', () => {
    expect(validateResources([person('r1', 'Marta'), person('r2', 'MARTA')])).toBe(
      'Duplicate name: "MARTA"',
    );
  });

  it('refuses a default availability of zero', () => {
    expect(validateResources([person('r1', 'Marta', 0)])).toMatch(/Invalid availability/);
  });

  it('refuses a default availability above one', () => {
    // The mistake an agent makes when it hands over a percentage.
    expect(validateResources([person('r1', 'Marta', 50)])).toMatch(/Invalid availability/);
  });

  it('refuses a period missing one of its ends', () => {
    const resource: Resource = {
      ...person('r1', 'Marta'),
      availabilityOverrides: [{ from: '2026-09-07', to: '', availability: 0 }],
    };
    expect(validateResources([resource])).toBe('A period of "Marta" has no start or end');
  });

  it('accepts a period at zero, which is how an absence is written', () => {
    const resource: Resource = {
      ...person('r1', 'Marta'),
      availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-11', availability: 0 }],
    };
    expect(validateResources([resource])).toBeNull();
  });

  it('refuses a period whose availability field is missing', () => {
    // The agent-API repro: `{from, to, ratio: 0}` — the field misspelt, so the
    // share is undefined and would reach the scheduler as NaN capacity.
    const resource: Resource = {
      ...person('r1', 'Marta'),
      availabilityOverrides: [
        { from: '2026-09-07', to: '2026-09-11', ratio: 0 } as unknown as AvailabilityOverride,
      ],
    };
    expect(validateResources([resource])).toMatch(/needs a numeric "availability" share/);
  });

  it('refuses a period whose date is not a day string', () => {
    const resource: Resource = {
      ...person('r1', 'Marta'),
      availabilityOverrides: [{ from: '07/09/2026', to: '2026-09-11', availability: 0 }],
    };
    expect(validateResources([resource])).toMatch(/malformed date/);
  });

  it('refuses a period share above one', () => {
    const resource: Resource = {
      ...person('r1', 'Marta'),
      availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-11', availability: 2 }],
    };
    expect(validateResources([resource])).toBe('A period of "Marta" has a share outside 0..1');
  });
});

describe('releasedBy', () => {
  it('names the resources that disappeared', () => {
    const previous = [person('r1', 'Marta'), person('r2', 'Bruno'), person('r3', 'Ada')];
    expect(releasedBy(previous, [previous[1]])).toEqual(['r1', 'r3']);
  });

  it('releases nobody when the list only changed in place', () => {
    const previous = [person('r1', 'Marta'), person('r2', 'Bruno')];
    const next = [person('r1', 'Marta Rossi'), person('r2', 'Bruno', 0.5)];
    expect(releasedBy(previous, next)).toEqual([]);
  });

  it('releases nobody when somebody was added', () => {
    const previous = [person('r1', 'Marta')];
    expect(releasedBy(previous, [...previous, person('r2', 'Bruno')])).toEqual([]);
  });
});

describe('nextResourceId', () => {
  it('starts at r1', () => {
    expect(nextResourceId([])).toBe('r1');
  });

  it('goes past the highest number in use, not past the count', () => {
    expect(nextResourceId([person('r1', 'Marta'), person('r7', 'Bruno')])).toBe('r8');
  });

  it('ignores ids that do not follow the pattern', () => {
    expect(nextResourceId([person('alice', 'Alice')])).toBe('r1');
  });
});

describe('the transformations', () => {
  it('adds a person with a fresh id and full availability by default', () => {
    const next = withResourceAdded([person('r1', 'Marta')], { name: ' Bruno ' });
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ id: 'r2', name: 'Bruno', availability: 1 });
  });

  it('leaves the fields a patch does not mention', () => {
    const previous = [
      {
        ...person('r1', 'Marta', 0.5),
        availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-11', availability: 0 }],
      },
    ];
    const next = withResourceUpdated(previous, 'r1', { name: 'Marta Rossi' });
    expect(next[0].availability).toBe(0.5);
    expect(next[0].availabilityOverrides).toHaveLength(1);
  });

  it('omits an empty override list rather than storing it', () => {
    const previous = [
      {
        ...person('r1', 'Marta'),
        availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-11', availability: 0 }],
      },
    ];
    expect(withAvailability(previous, 'r1', [])).toEqual([
      { id: 'r1', name: 'Marta', availability: 1 },
    ]);
  });

  it('replaces the whole ordered override list, because the order is semantics', () => {
    const overrides = [
      { from: '2026-09-01', to: '2026-09-30', availability: 0.5 },
      { from: '2026-09-14', to: '2026-09-18', availability: 0 },
    ];
    const next = withAvailability([person('r1', 'Marta')], 'r1', overrides);
    expect(next[0].availabilityOverrides).toEqual(overrides);
  });

  it('removes only the named person', () => {
    const previous = [person('r1', 'Marta'), person('r2', 'Bruno')];
    expect(withResourceRemoved(previous, 'r1')).toEqual([previous[1]]);
  });
});
