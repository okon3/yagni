import { useEffect, useRef, useState } from 'react';
import type { CalendarSpec, DayRange } from '../scheduler';
import { DayRangeList } from './DayRangeList';

const WEEKDAYS = [
  { day: 1, label: 'Lun' },
  { day: 2, label: 'Mar' },
  { day: 3, label: 'Mer' },
  { day: 4, label: 'Gio' },
  { day: 5, label: 'Ven' },
  { day: 6, label: 'Sab' },
  { day: 0, label: 'Dom' },
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
      setError('Serve almeno un giorno lavorativo alla settimana');
      return;
    }
    if (holidays.some((range) => !range.from || !range.to)) {
      setError('Ogni chiusura deve avere una data di inizio e una di fine');
      return;
    }
    onSave({ ...calendar, workingDays, holidays });
  };

  return (
    <dialog ref={dialog} className="resources calendar" onCancel={onCancel} onClose={onCancel}>
      <h2>Calendario di progetto</h2>
      <p className="resources__hint">
        Le chiusure aziendali valgono per tutti e vengono escluse dal calendario: le attività si
        spostano in avanti, ma il loro effort non cambia. Le assenze delle singole persone si
        impostano in <strong>Persone</strong>.
      </p>

      <div className="calendar__week">
        <span className="calendar__weekLabel">Giorni lavorativi</span>
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

      <h3 className="calendar__subhead">Chiusure</h3>
      <DayRangeList
        ranges={holidays}
        workingWeekdays={workingDays}
        labelPlaceholder="Motivo (opzionale)"
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
          Annulla
        </button>
        <button type="button" className="resources__primary" onClick={save}>
          Salva
        </button>
      </div>
    </dialog>
  );
}
