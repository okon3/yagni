/**
 * Hands the system's colour scheme to dhtmlx.
 *
 * The app's own palette follows `prefers-color-scheme` in CSS and needs nothing
 * here, but dhtmlx v10 keys its built-in dark theme off an attribute on the root
 * element instead of a media query — so the one thing that cannot be expressed
 * in a stylesheet is setting it.
 *
 * Called once at startup, outside React: it must not depend on a render, and the
 * listener lives as long as the document does.
 */
export function followSystemColorScheme(): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    if (dark.matches) document.documentElement.dataset.ganttTheme = 'dark';
    // Removed rather than set to the light theme's name: absent is what dhtmlx
    // treats as its default, and naming it would pin us to that default's name.
    else delete document.documentElement.dataset.ganttTheme;
  };
  apply();
  dark.addEventListener('change', apply);
}
