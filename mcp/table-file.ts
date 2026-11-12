import {
	basename,
	dirname,
	join,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from './node-api';

/**
 * Reading and writing a table file so that a write cannot silently replace a
 * change that landed after the caller read it.
 *
 * The server is one writer among others: Obsidian itself, a sync client, or a
 * second assistant process may write the same file. `writeFileText` therefore
 * re-reads the file immediately before replacing it and refuses when the text
 * has moved. The replacement itself goes through a temporary file so a crash
 * leaves the old file intact instead of half a JSON document.
 */

/** The file's exact text, which `writeFileText` uses as its revision. */
export function readFileText(file: string): string {
	return readFileSync(file, 'utf8');
}

/** The sentence a caller can pass on when another writer changed the file. */
export function changedElsewhereMessage(file: string): string {
	return `"${file}" changed on disk after this call read it. Nothing was written. Read the table again and re-apply the change. Tell the user the table was changed by something else while this operation was running.`;
}

/**
 * Replaces a table file only when it still holds `expectedText`.
 *
 * The temporary file lives in the same folder so the rename stays atomic; a
 * folder on another volume would turn it into a copy. Its name starts with a
 * dot, which Obsidian's vault does not treat as a table.
 */
export function writeFileText(
	file: string,
	text: string,
	expectedText: string,
): void {
	const current = readFileText(file);
	if (current !== expectedText) {
		throw new Error(changedElsewhereMessage(file));
	}
	const temp = join(
		dirname(file),
		`.${basename(file)}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		writeFileSync(temp, text, 'utf8');
		renameSync(temp, file);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// The write may have failed before the file existed; the original error matters more.
		}
		throw error;
	}
}

/**
 * Creates a new table file, refusing a path that already holds anything.
 *
 * `wx` is an atomic "create only if absent": checking first and writing after
 * would let a second process take the name in between.
 */
export function createFileText(file: string, text: string): void {
	writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
}
