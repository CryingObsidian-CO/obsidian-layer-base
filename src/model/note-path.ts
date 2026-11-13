import type { NoteLabelStyle } from '../types';

/** A stored note path as shown. `.md` is dropped in both styles: a reader thinks of a note by its
 * name, and the extension only makes the cell longer. */
export function noteLabel(path: string, style: NoteLabelStyle): string {
	const shown = path.endsWith('.md') ? path.slice(0, -'.md'.length) : path;
	if (style === 'path') {
		return shown;
	}
	const slash = shown.lastIndexOf('/');
	return slash < 0 ? shown : shown.slice(slash + 1);
}
