/**
 * What is on screen when there is no plan yet.
 *
 * Two ways in and one way to learn how it works. The instructions that used to
 * be here moved into the help dialog: they were read once, by someone who had
 * not yet seen a bar, and then stood between that person and the two buttons
 * they actually needed.
 */
export function EmptyState({
  onAddTask,
  onOpen,
  onHelp,
}: {
  onAddTask(): void;
  onOpen(): void;
  onHelp(): void;
}) {
  return (
    <div className="empty">
      <div className="empty__card">
        <h2>Un piano vuoto</h2>
        <p className="empty__lead">
          Dichiari l&apos;<strong>effort</strong> e da quando un&apos;attività può partire. La data
          di fine la calcola il motore, tenendo conto di chi ci lavora e di cos&apos;altro sta
          facendo nello stesso momento.
        </p>

        <div className="empty__actions">
          <button type="button" className="empty__primary" onClick={onAddTask}>
            Crea la prima attività
          </button>
          <button type="button" className="empty__secondary" onClick={onOpen}>
            Apri un file .gantt
          </button>
        </div>

        <p className="empty__note">
          Oppure trascina qui un <code>.gantt</code> dal computer.
        </p>

        <button type="button" className="empty__help" onClick={onHelp}>
          Come funziona la ripartizione dell&apos;effort
        </button>
      </div>
    </div>
  );
}
