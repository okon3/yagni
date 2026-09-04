import { useEffect, useRef, useState } from 'react';
import type { CalendarSpec, DayRange } from '../scheduler';
import { DayRangeList } from './DayRangeList';

const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

/** Mounted only while open, so the draft initialises from props without an effect. */
export function CalendarDialog({
  calendar,
  onCancel,
  onSave,
}: {
  calendar: CalendarSpec;
  onCancel(): void;
  onSave(calendar: CalendarSpec): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [workingDays, setWorkingDays] = useState<number[]>(calendar.workingDays);
  const [holidays, setHolidays] = useState<DayRange[]>(calendar.holidays ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const toggleDay = (day: number) => {
    setWorkingDays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort(),
    );
  };

  const save = () => {
    if (workingDays.length === 0) {
      setError('At least one working day a week is required');
      return;
    }
    if (holidays.some((range) => !range.from || !range.to)) {
      setError('Every shutdown needs a start date and an end date');
      return;
    }
    onSave({ ...calendar, workingDays, holidays });
  };

  return (
    <dialog ref={dialog} className="resources calendar" onCancel={onCancel} onClose={onCancel}>
      <h2>Project calendar</h2>
      <p className="resources__hint">
        Company shutdowns apply to everyone and are excluded from the calendar: tasks shift
        forward, but their effort does not change. Individual absences are set in{' '}
        <strong>People</strong>.
      </p>

      <div className="calendar__week">
        <span className="calendar__weekLabel">Working days</span>
        <div className="calendar__days">
          {WEEKDAYS.map(({ day, label }) => (
            <label key={day} className="calendar__day">
              <input
                type="checkbox"
                checked={workingDays.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <h3 className="calendar__subhead">Shutdowns</h3>
      <DayRangeList
        ranges={holidays}
        workingWeekdays={workingDays}
        labelPlaceholder="Reason (optional)"
        onChange={setHolidays}
      />

      {error && (
        <p className="resources__error" role="alert">
          {error}
        </p>
      )}

      <div className="resources__actions">
        <span className="resources__spacer" />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="resources__primary" onClick={save}>
          Save
        </button>
      </div>
    </dialog>
  );
}
