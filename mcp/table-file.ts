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

/** Removes the temporary file, ignoring a failure: the caller's error matters more. */
function removeTemp(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// The write may have failed before the file existed.
	}
}

/**
 * Replaces a table file only when it still holds `expectedText`.
 *
 * The temporary file lives in the same folder so the rename stays atomic; a
 * folder on another volume would turn it into a copy. Its name starts with a
 * dot, which Obsidian's vault does not treat as a table.
 *
 * The new document is written to the temporary file before the revision is
 * checked, so the window between that check and the rename holds those two calls
 * and nothing else. Writing first would be the slow half — a whole document —
 * and putting it after the check would leave that half open to another writer.
 *
 * A writer landing between the check and the rename is still lost. Closing that
 * would take an exclusive lock, and the writers worth stopping — Obsidian's own
 * save, a sync client — do not take one; a lock this server alone honours would
 * only serialize its own processes, which are not what the check is for.
 */
export function writeFileText(
	file: string,
	text: string,
	expectedText: string,
): void {
	const temp = join(
		dirname(file),
		`.${basename(file)}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		writeFileSync(temp, text, 'utf8');
	} catch (error) {
		removeTemp(temp);
		throw error;
	}
	const current = readFileText(file);
	if (current !== expectedText) {
		removeTemp(temp);
		throw new Error(changedElsewhereMessage(file));
	}
	try {
		renameSync(temp, file);
	} catch (error) {
		removeTemp(temp);
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
