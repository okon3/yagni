/**
 * What is on screen when there is no plan yet.
 *
 * Two ways in and one way to learn how it works. What used to be here — five
 * numbered steps, then a paragraph on effort — moved into the help dialog: it
 * was read once, by somebody who had not yet seen a bar, and from then on it
 * stood between that person and the two buttons they actually came for.
 *
 * The heading is the app's own name and one line saying what kind of tool it is.
 * Naming the absence instead — "No tasks", "An empty plan" — tells somebody
 * staring at an empty screen the one thing they already know.
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
        <h2>YAGNI</h2>
        <p className="empty__lead">
          A Gantt tool built on <strong>effort</strong>: dates are computed by the engine.
        </p>

        <div className="empty__actions">
          <button type="button" className="empty__primary" onClick={onAddTask}>
            Create the first task
          </button>
          <button type="button" className="empty__secondary" onClick={onOpen}>
            Open a .gantt file
          </button>
        </div>

        <p className="empty__note">
          Or drag a <code>.gantt</code> file here from your computer.
        </p>

        <button type="button" className="empty__help" onClick={onHelp}>
          Need help?
        </button>
      </div>
    </div>
  );
}
