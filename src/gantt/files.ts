/** Extension used by onlinegantt.com, kept so the two are interchangeable by habit. */
export const PROJECT_EXTENSION = '.gantt';

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Resolves with null when the user dismisses the picker. */
export function pickTextFile(accept = PROJECT_EXTENSION): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => resolve({ name: file.name, text }))
        .catch(reject);
    });
    // Fires when the dialog is dismissed; without it the promise never settles.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
