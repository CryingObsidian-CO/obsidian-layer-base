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
 *
 * `isTable` has to answer "is a table here", not "is there something here". The
 * stored path can name a note, an attachment or a folder; taking that for the
 * answer leaves the cell empty, because the thing is not a `.layer` file and
 * nothing gets read — and the by-name fallback that would have found the table
 * never runs, since this branch already said the search was over.
 */
export function pickTablePath(
	storedPath: string,
	tables: readonly string[],
	isTable: (path: string) => boolean,
): string | null {
	if (isTable(storedPath)) {
		return storedPath;
	}
	const wanted = tableBasename(storedPath);
	const matches = tables.filter((path) => tableBasename(path) === wanted);
	return matches.length === 1 ? (matches[0] ?? null) : null;
}
