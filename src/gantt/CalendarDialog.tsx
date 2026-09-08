import { useState } from 'react';
import type { CalendarSpec, DayRange } from '../scheduler';
import { Dialog } from './Dialog';
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
  const [workingDays, setWorkingDays] = useState<number[]>(calendar.workingDays);
  const [holidays, setHolidays] = useState<DayRange[]>(calendar.holidays ?? []);
  const [error, setError] = useState<string | null>(null);

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
    <Dialog
      title="Project calendar"
      width={560}
      className="calendar"
      onDismiss={onCancel}
      error={error}
      footer={
        <>
          <span className="dialog__spacer" />
          <button type="button" className="dialog__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog__btn dialog__btn--primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog__hint">
        Company shutdowns apply to everyone and are excluded from the calendar: tasks shift
        forward, but their effort does not change. Individual absences are set in{' '}
        <strong>People</strong>.
      </p>

      <h3 className="dialog__subhead">Working days</h3>
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

      <h3 className="dialog__subhead">Shutdowns</h3>
      <DayRangeList
        ranges={holidays}
        workingWeekdays={workingDays}
        labelPlaceholder="Reason"
        onChange={setHolidays}
      />
    </Dialog>
  );
}
