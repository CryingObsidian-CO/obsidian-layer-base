/** The file name of a vault path, without its folder or extension. */
export function tableBasename(path: string): string {
	const tail = path.slice(path.lastIndexOf('/') + 1);
	const dot = tail.lastIndexOf('.');
	return dot === -1 ? tail : tail.slice(0, dot);
}

/**
 * Which table a stored link should actually read.
 *
 * A rename or a move leaves the stored path pointing at nothing, and this plugin
 * never writes a file it is not the one being edited, so the fallback is by name:
 * when exactly one table still carries that filename, it is the one. Two matches
 * are left unresolved rather than guessed between — picking one would silently
 * point a link at the wrong table.
 */
export function pickTablePath(
	storedPath: string,
	tables: readonly string[],
	exists: (path: string) => boolean,
): string | null {
	if (exists(storedPath)) {
		return storedPath;
	}
	const wanted = tableBasename(storedPath);
	const matches = tables.filter((path) => tableBasename(path) === wanted);
	return matches.length === 1 ? (matches[0] ?? null) : null;
}
