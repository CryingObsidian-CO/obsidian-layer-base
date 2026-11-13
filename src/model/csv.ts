/** CSV export. Kept free of `obsidian` so the quoting rules stay testable. */

/** One row of already-resolved cell text. */
export type CsvRow = readonly string[];

export interface CsvOptions {
	/** Prefix a value a spreadsheet would evaluate as a formula with an apostrophe. */
	guardFormulas?: boolean;
}

/** A leading `=`, `+`, `-` or `@` starts a formula in Excel, LibreOffice and Sheets. */
const FORMULA_START = /^[=+\-@\t\r\n]/;
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

function readsAsFormula(value: string): boolean {
	// A plain number is exempt: prefixing it would turn a numeric column into text.
	return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value);
}

/** One CSV field, quoted when it holds a comma, a quote or a line break. */
export function csvField(value: string, options: CsvOptions = {}): string {
	const text =
		options.guardFormulas === true && readsAsFormula(value)
			? `'${value}`
			: value;
	const needsQuotes = /[",\r\n]/.test(text);
	if (!needsQuotes) {
		return text;
	}
	return `"${text.replace(/"/g, '""')}"`;
}

/** One CRLF-terminated row. */
export function csvLine(
	cells: readonly string[],
	options: CsvOptions = {},
): string {
	return cells.map((cell) => csvField(cell, options)).join(',') + '\r\n';
}

/** The whole file: a BOM, then a header row and one row per record. */
export function toCsv(
	header: readonly string[],
	rows: readonly CsvRow[],
	options: CsvOptions = {},
): string {
	let text = '\uFEFF';
	text += csvLine(header, options);
	for (const row of rows) {
		text += csvLine(row, options);
	}
	return text;
}

/** A board name made safe for a file name, measured in bytes rather than characters. */
const MAX_NAME_BYTES = 200;

/** Cuts text to a byte budget without splitting a character in half. */
function clampToBytes(text: string, limit: number): string {
	const encoder = new TextEncoder();
	let used = 0;
	let out = '';
	for (const character of text) {
		const size = encoder.encode(character).length;
		if (used + size > limit) {
			break;
		}
		out += character;
		used += size;
	}
	return out;
}

/** A `.csv` file name derived from a board name. */
export function csvFileName(boardName: string): string {
	const safe = boardName
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\p{Cc}/gu, '')
		.trim()
		.replace(/[. ]+$/, '');
	const base = clampToBytes(safe, MAX_NAME_BYTES).trim();
	// Nothing left, or only dots: fall back so the export is not a hidden dotfile.
	return `${/^\.*$/.test(base) ? 'export' : base}.csv`;
}
