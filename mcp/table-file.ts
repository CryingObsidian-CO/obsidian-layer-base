import {
	basename,
	dirname,
	join,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from './node-api';

/*
 * Reading and writing a table file so a write cannot silently replace a change that
 * landed after the caller read it: re-read just before replacing, write a temp file in
 * the same folder, then rename, so a crash leaves the old file intact.
 */

/** The exact text, which `writeFileText` compares as its revision. */
export function readFileText(file: string): string {
	return readFileSync(file, 'utf8');
}

export function changedElsewhereMessage(file: string): string {
	return `"${file}" changed on disk after this call read it. Nothing was written. Read the table again and re-apply the change. Tell the user the table was changed by something else while this operation was running.`;
}

function removeTemp(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// The write may have failed before the file existed.
	}
}

/**
 * Replaces the file only when it still holds `expectedText`; the temp file is beside it, so
 * the rename is atomic and a crash leaves the old file intact. A writer that lands between
 * the read and the rename is still lost: the writers worth stopping take no lock.
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

/** `wx` is an atomic create-if-absent: a check-then-write would let a second process take the name. */
export function createFileText(file: string, text: string): void {
	writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
}
