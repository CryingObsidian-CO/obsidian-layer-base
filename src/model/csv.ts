/**
 * Turning a table into CSV text.
 *
 * Kept free of `obsidian` so the quoting rules can be unit tested: getting them
 * wrong is the classic way an export silently corrupts a value — an unquoted comma
 * splits one cell into two, and a missing doubled quote ends the field early.
 */

/** One row of already-resolved cell text. */
export type CsvRow = readonly string[];

export interface CsvOptions {
	/**
	 * Write a value a spreadsheet would take for a formula as text instead, so
	 * opening the file cannot run it.
	 *
	 * Off unless asked: the prefix changes the value, and a consumer that is not a
	 * spreadsheet — a script, another importer — must not receive it uninvited. The
	 * export asks for it, because a spreadsheet is what a `.csv` is written for.
	 */
	guardFormulas?: boolean;
}

/**
 * Whether a spreadsheet would read this field as a formula.
 *
 * A leading `=`, `+`, `-` or `@` begins one in Excel, LibreOffice and Google
 * Sheets, and a leading tab or line break is the same trick written another way.
 * Quoting the field does not help: the quotes only delimit it, and the sheet still
 * evaluates what it finds inside.
 *
 * A plain number is exempt. `-5` and `+3.5` start the same way but can only be a
 * number, and prefixing them would turn a numeric column into text in the sheet.
 */
const FORMULA_START = /^[=+\-@\t\r\n]/;
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

function readsAsFormula(value: string): boolean {
	return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value);
}

/**
 * A value as one CSV field.
 *
 * Quoted whenever it holds anything that could be read as structure — a comma, a
 * quote, or a line break — and an inner quote is doubled, which is how the format
 * escapes it. Values that need none of that are left bare so the file stays
 * readable.
 *
 * With `guardFormulas`, a value a spreadsheet would evaluate gets a leading
 * apostrophe first, which is how a sheet is told to keep it as text.
 */
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

/** One line of CSV, ending with the format's carriage return and newline. */
export function csvLine(
	cells: readonly string[],
	options: CsvOptions = {},
): string {
	return cells.map((cell) => csvField(cell, options)).join(',') + '\r\n';
}

/**
 * The whole file: a header row, then one row per record.
 *
 * CRLF is used because that is what the format specifies, and a spreadsheet that
 * expects it is a common target for an export. A byte-order mark is written so
 * Excel opens UTF-8 text without mangling non-Latin characters, which matters here
 * because these tables are routinely written in Chinese.
 */
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

/**
 * A file name derived from the board's name.
 *
 * A name a file system refuses is not a name: the characters Windows and macOS
 * refuse are replaced, an ending of dots or spaces is dropped (the OS trims it
 * anyway, so `foo.` would land as `foo..csv`), and the rest is trimmed to fit.
 * The limit is counted in bytes rather than characters because that is the side
 * that runs out first — three-byte characters reach 255 bytes at 85 characters,
 * while the character limit is 255 on its own.
 */
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

export function csvFileName(boardName: string): string {
	// Characters Windows and macOS refuse, plus the control range, which a stray
	// paste can put into a name and which no file system accepts.
	const safe = boardName
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\p{Cc}/gu, '')
		.trim()
		.replace(/[. ]+$/, '');
	const base = clampToBytes(safe, MAX_NAME_BYTES).trim();
	/*
	 * Nothing left, or nothing but dots: the first has no name at all, and the
	 * second starts the file name with a dot, which hides the export on macOS and
	 * Linux.
	 */
	return `${/^\.*$/.test(base) ? 'export' : base}.csv`;
}
