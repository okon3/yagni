import { X } from 'lucide-react';
import { countWorkingDaysInRange, type AvailabilityOverride } from '../scheduler';

/**
 * Editor for the periods where somebody's availability differs from their
 * default. Zero percent is an absence — same mechanism, no separate concept.
 */
export function AvailabilityList({
  periods,
  workingWeekdays,
  onChange,
}: {
  periods: AvailabilityOverride[];
  workingWeekdays: number[];
  onChange(periods: AvailabilityOverride[]): void;
}) {
  const update = (index: number, patch: Partial<AvailabilityOverride>) => {
    onChange(
      periods.map((period, position) => (position === index ? { ...period, ...patch } : period)),
    );
  };

  const add = () => {
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    onChange([...periods, { from: iso, to: iso, availability: 0 }]);
  };

  return (
    <div className="ranges">
      {periods.length === 0 && (
        <p className="ranges__empty">
          No periods: the default availability applies for the whole project.
        </p>
      )}

      {periods.map((period, index) => {
        const working = countWorkingDaysInRange(period, workingWeekdays);
        const percent = Math.round(period.availability * 100);
        return (
          <div className="ranges__row ranges__row--pct" key={index}>
            <input
              className="dialog__control ranges__date"
              type="date"
              value={period.from}
              onChange={(event) => update(index, { from: event.target.value })}
            />
            <span className="ranges__to">→</span>
            <input
              className="dialog__control ranges__date"
              type="date"
              value={period.to}
              min={period.from}
              onChange={(event) => update(index, { to: event.target.value })}
            />
            <span className="dialog__field">
              <input
                className="dialog__control ranges__pct"
                type="number"
                min={0}
                max={100}
                step={5}
                value={percent}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  update(index, {
                    availability: Number.isFinite(next) ? Math.min(100, Math.max(0, next)) / 100 : 0,
                  });
                }}
              />
              <span className="dialog__suffix">%</span>
            </span>
            <input
              className="dialog__control ranges__label"
              placeholder={percent === 0 ? 'Leave, time off...' : 'Reason (optional)'}
              value={period.label ?? ''}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <span className={`ranges__count${working === 0 ? ' ranges__count--none' : ''}`}>
              {working === 0
                ? 'no working days'
                : `${working} ${working === 1 ? 'day' : 'days'}${percent === 0 ? ' away' : ''}`}
            </span>
            <button
              type="button"
              className="dialog__btn dialog__btn--danger ranges__remove"
              onClick={() => onChange(periods.filter((_, position) => position !== index))}
              title="Remove"
              aria-label="Remove"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      <button type="button" className="dialog__btn ranges__add" onClick={add}>
        Add period
      </button>
    </div>
  );
}
