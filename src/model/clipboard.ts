import type { CellValue, FieldType } from '../types';

export interface FormattedCell {
	type: FieldType;
	value: CellValue;
	text: string;
}

export interface FormattedClipboard {
	text: string;
	rows: FormattedCell[][];
}

let buffered: string | null = null;
let formatted: FormattedClipboard | null = null;

export async function copyFormatted(payload: FormattedClipboard): Promise<void> {
	buffered = payload.text;
	formatted = payload;
	await writeSystem(payload.text);
}

async function writeSystem(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch (error) {
		console.warn(
			'[obsidian-layer-base] Could not write to the system clipboard; the value is still available for pasting inside the plugin:',
			error,
		);
	}
}

export async function readText(): Promise<string | null> {
	if (buffered !== null) {
		return buffered;
	}
	try {
		const text = await navigator.clipboard.readText();
		return text === '' ? null : text;
	} catch {
		return null;
	}
}

export async function readFormatted(): Promise<FormattedClipboard | null> {
	if (formatted === null) {
		return null;
	}
	try {
		const current = await navigator.clipboard.readText();
		if (current !== formatted.text) {
			formatted = null;
			buffered = current === '' ? null : current;
			return null;
		}
	} catch {
		// Cannot verify; the payload is still the most recent one written.
	}
	return formatted;
}

export function clearClipboardBuffer(): void {
	buffered = null;
	formatted = null;
}
