import type { CellValue, FieldType } from '../types';

/**
 * Clipboard access for cell values.
 *
 * There are two kinds of copy, and they answer different questions:
 *
 * - **Formatted** keeps what the value *is*. It carries the field type and the
 *   stored value, so a select survives as its option id and can be refused by a
 *   column of another type instead of silently becoming text.
 * - **Plain text** keeps only what the value *says*, for taking the content
 *   somewhere else.
 *
 * Copy and paste are separate verbs, which is the point: copying changes
 * nothing, and pasting is explicit. An earlier version fused them — "duplicate
 * row" appended a copy immediately — so there was no way to copy a value without
 * also creating data.
 *
 * The system clipboard holds text only, so the structured payload lives in memory
 * beside it. Every formatted copy writes both, which means an external
 * application sees the tab-separated text while this plugin can paste the exact
 * values back.
 */

/**
 * One cell as it was copied: what it was, and what it held.
 *
 * `text` is carried alongside the stored value because option ids belong to a
 * field — pasting a select value into a *different* select column would write an
 * id that column has never heard of, and the cell would then display the raw id.
 * The text is what the value looked like at the source, and gives the destination
 * something to resolve against.
 */
export interface FormattedCell {
	type: FieldType;
	value: CellValue;
	text: string;
}

export interface FormattedClipboard {
	/** The text written to the system clipboard alongside this payload. */
	text: string;
	/** Raw values in row-major order. */
	rows: FormattedCell[][];
}

let buffered: string | null = null;
let formatted: FormattedClipboard | null = null;

/** Writes text plus the structure needed to paste values back exactly. */
export async function copyFormatted(payload: FormattedClipboard): Promise<void> {
	buffered = payload.text;
	formatted = payload;
	await writeSystem(payload.text);
}

async function writeSystem(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch (error) {
		// The buffer still holds the value, so pasting inside the plugin keeps
		// working even when the system clipboard refuses.
		console.warn(
			'[obsidian-layer-base] Could not write to the system clipboard; the value is still available for pasting inside the plugin:',
			error,
		);
	}
}

/**
 * The text to paste, or null when there is nothing.
 *
 * Prefers the buffer, because it is what this plugin last copied and cannot be
 * blocked. Falls back to the system clipboard so values copied elsewhere can be
 * pasted in.
 */
export async function readText(): Promise<string | null> {
	if (buffered !== null) {
		return buffered;
	}
	try {
		const text = await navigator.clipboard.readText();
		return text === '' ? null : text;
	} catch {
		// Reading is denied in some contexts. Nothing to paste, which is a
		// legitimate outcome rather than an error worth interrupting for.
		return null;
	}
}

/**
 * The structured payload, or null when the clipboard no longer holds it.
 *
 * Verified against the system clipboard rather than trusted outright: the user
 * may have copied something in another application since, and pasting a stale
 * payload would write the wrong values. When the system clipboard cannot be read
 * the payload is kept, because the alternative — refusing every paste — would
 * break the common case to guard against the rare one.
 */
export async function readFormatted(): Promise<FormattedClipboard | null> {
	if (formatted === null) {
		return null;
	}
	try {
		const current = await navigator.clipboard.readText();
		if (current !== formatted.text) {
			// Something else is on the clipboard now.
			formatted = null;
			buffered = current === '' ? null : current;
			return null;
		}
	} catch {
		// Cannot verify; the payload is still the most recent thing we wrote.
	}
	return formatted;
}

/** Drops the remembered values. Used by tests to isolate cases. */
export function clearClipboardBuffer(): void {
	buffered = null;
	formatted = null;
}
