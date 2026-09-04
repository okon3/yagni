import changelogText from '../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';

// Parsed once: the text is static, bundled at build time. Its own module so
// the dialog component stays a component-only export (fast refresh).
export const CHANGELOG_ENTRIES = parseChangelog(changelogText);
