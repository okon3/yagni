/** Extension used by onlinegantt.com, kept so the two are interchangeable by habit. */
export const PROJECT_EXTENSION = '.gantt';

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  downloadBlob(filename, new Blob([text], { type }));
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

/**
 * `progetto.gantt` → `progetto.csv`, and a name carrying no extension gains one.
 *
 * Every export takes the project's own name so that a plan and its pictures land
 * in the download folder next to each other.
 */
export function exportFilename(projectFilename: string, extension: string): string {
  const stem = projectFilename.toLowerCase().endsWith(PROJECT_EXTENSION)
    ? projectFilename.slice(0, -PROJECT_EXTENSION.length)
    : projectFilename;
  return `${stem}.${extension}`;
}

/**
 * Rasterises a self-contained SVG and downloads it as a PNG.
 *
 * Through an `<img>` and a canvas, which is the only route a browser offers
 * without a library: the markup goes in as a blob URL, so the canvas stays
 * same-origin and `toBlob` is allowed to read it back. `scale` is a
 * multiplication of the pixels, not of the layout — the figure is laid out once,
 * at the size it was asked for.
 */
export async function downloadSvgAsPng(
  filename: string,
  figure: { svg: string; width: number; height: number },
  scale = 2,
): Promise<void> {
  const source = URL.createObjectURL(new Blob([figure.svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve());
      image.addEventListener('error', () => reject(new Error('Immagine del piano non generata')));
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(figure.width * scale);
    canvas.height = Math.ceil(figure.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas non disponibile');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG non generato');
    downloadBlob(filename, png);
  } finally {
    URL.revokeObjectURL(source);
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
