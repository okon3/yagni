import { useEffect, useRef } from 'react';
import { CHANGELOG_ENTRIES } from './changelogEntries';

/** Reached from the version badge in the header. */
export function ChangelogDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.focus();
    if (node) node.scrollTop = 0;
  }, []);

  return (
    <dialog ref={dialog} className="resources help" tabIndex={-1} onCancel={onClose}>
      <h2>What's new</h2>

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

      <div className="resources__actions">
        <span className="resources__spacer" />
        <button type="button" className="resources__primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
