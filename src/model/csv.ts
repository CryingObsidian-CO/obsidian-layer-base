/**
 * Turning a table into CSV text.
 *
 * Kept free of `obsidian` so the quoting rules can be unit tested: getting them
 * wrong is the classic way an export silently corrupts a value — an unquoted comma
 * splits one cell into two, and a missing doubled quote ends the field early.
 */

/** One row of already-resolved cell text. */
export type CsvRow = readonly string[];

/**
 * A value as one CSV field.
 *
 * Quoted whenever it holds anything that could be read as structure — a comma, a
 * quote, or a line break — and an inner quote is doubled, which is how the format
 * escapes it. Values that need none of that are left bare so the file stays
 * readable.
 */
export function csvField(value: string): string {
	const needsQuotes = /[",\r\n]/.test(value);
	if (!needsQuotes) {
		return value;
	}
	return `"${value.replace(/"/g, '""')}"`;
}

/** One line of CSV, ending with the format's carriage return and newline. */
export function csvLine(cells: readonly string[]): string {
	return cells.map(csvField).join(',') + '\r\n';
}

/**
 * The whole file: a header row, then one row per record.
 *
 * CRLF is used because that is what the format specifies, and a spreadsheet that
 * expects it is a common target for an export. A byte-order mark is written so
 * Excel opens UTF-8 text without mangling non-Latin characters, which matters here
 * because these tables are routinely written in Chinese.
 */
export function toCsv(header: readonly string[], rows: readonly CsvRow[]): string {
	let text = '\uFEFF';
	text += csvLine(header);
	for (const row of rows) {
		text += csvLine(row);
	}
	return text;
}

/** A file name that is safe on every platform, derived from the board's name. */
export function csvFileName(boardName: string): string {
	// Characters Windows and macOS refuse, plus the control range, which a stray
	// paste can put into a name and which no file system accepts.
	const safe = boardName
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\p{Cc}/gu, '')
		.trim();
	const base = safe === '' ? 'export' : safe;
	return `${base}.csv`;
}
