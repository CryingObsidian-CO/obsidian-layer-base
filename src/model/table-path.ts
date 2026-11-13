export function tableBasename(path: string): string {
	const tail = path.slice(path.lastIndexOf('/') + 1);
	const dot = tail.lastIndexOf('.');
	return dot === -1 ? tail : tail.slice(0, dot);
}

/** The table a stored link should read: the path itself, else the one table whose filename still
 * matches it. Two matches stay unresolved rather than guessed. `isTable` must answer "is a table
 * here", not "is something here": a note at the stored path would end the search with nothing read. */
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
