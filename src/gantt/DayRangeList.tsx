import { X } from 'lucide-react';
import { countWorkingDaysInRange, type DayRange } from '../scheduler';


function describe(range: DayRange, workingWeekdays: number[]): string {
  const working = countWorkingDaysInRange(range, workingWeekdays);
  if (working === 0) return 'no working days';
  return working === 1 ? '1 day' : `${working} days`;
}

export function DayRangeList({
  ranges,
  workingWeekdays,
  labelPlaceholder,
  onChange,
}: {
  ranges: DayRange[];
  workingWeekdays: number[];
  labelPlaceholder: string;
  onChange(ranges: DayRange[]): void;
}) {
  const update = (index: number, patch: Partial<DayRange>) => {
    onChange(ranges.map((range, position) => (position === index ? { ...range, ...patch } : range)));
  };

  const add = () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    onChange([...ranges, { from: iso, to: iso }]);
  };

  return (
    <div className="ranges">
      {ranges.length === 0 && <p className="ranges__empty">No periods.</p>}

      {ranges.map((range, index) => (
        <div className="ranges__row" key={index}>
          <input
            className="dialog__control ranges__date"
            type="date"
            value={range.from}
            onChange={(event) => update(index, { from: event.target.value })}
          />
          <span className="ranges__to">→</span>
          <input
            className="dialog__control ranges__date"
            type="date"
            value={range.to}
            // A single day is the common case, so the end follows the start when
            // it would otherwise be left behind it.
            min={range.from}
            onChange={(event) => update(index, { to: event.target.value })}
          />
          <input
            className="dialog__control ranges__label"
            placeholder={labelPlaceholder}
            value={range.label ?? ''}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <span
            className={`ranges__count${
              countWorkingDaysInRange(range, workingWeekdays) === 0 ? ' ranges__count--none' : ''
            }`}
          >
            {describe(range, workingWeekdays)}
          </span>
          <button
            type="button"
            className="dialog__btn dialog__btn--danger ranges__remove"
            onClick={() => onChange(ranges.filter((_, position) => position !== index))}
            title="Remove"
            aria-label="Remove"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      <button type="button" className="dialog__btn ranges__add" onClick={add}>
        Add period
      </button>
    </div>
  );
}
