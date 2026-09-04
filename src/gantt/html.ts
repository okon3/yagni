/**
 * dhtmlx takes a column template, a bar label and a tooltip as HTML strings, so
 * anything of the user's that reaches one has to be escaped on the way in.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}
