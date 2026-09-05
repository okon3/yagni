import { Dialog } from './Dialog';
import { CHANGELOG_ENTRIES } from './changelogEntries';

/** Reached from the version badge in the header. */
export function ChangelogDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog
      title="What's new"
      width={720}
      className="help"
      onDismiss={onClose}
      footer={
        <>
          <span className="dialog__spacer" />
          <button type="button" className="dialog__btn dialog__btn--primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {CHANGELOG_ENTRIES.map((entry) => (
        <section key={entry.version} className="help__section">
          <h3>
            {entry.version} — {entry.date}
          </h3>
          <ul>
            {entry.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
    </Dialog>
  );
}
