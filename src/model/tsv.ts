/**
 * The clipboard format for a rectangle of cells.
 *
 * Tab between columns, newline between rows — the spreadsheet interchange
 * format, so a copied range pastes into Excel, Sheets or a text file and comes
 * back intact. Inventing a separator would have made the clipboard useful only
 * inside this plugin.
 *
 * A single cell is a 1x1 grid, so "copy one value" and "copy a range" need no
 * separate code paths: the general case already covers the small one.
 */

/** Splits clipboard text into a grid of raw cell strings. */
export function parseGrid(text: string): string[][] {
	// A trailing newline is how files end, not an extra empty row.
	const body = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
	return body.split('\n').map((line) => line.split('\t'));
}

/** Joins a grid back into clipboard text. */
export function formatGrid(rows: readonly (readonly string[])[]): string {
	return rows.map((row) => row.join('\t')).join('\n');
}

/** The shape of a grid, for reporting and for planning a paste. */
export interface GridShape {
	rows: number;
	columns: number;
}

export function gridShape(rows: readonly (readonly string[])[]): GridShape {
	return {
		rows: rows.length,
		columns: rows.reduce((widest, row) => Math.max(widest, row.length), 0),
	};
}

/**
 * Reads the cell at a position, treating a short row as empty rather than
 * absent.
 *
 * A ragged block is normal — a spreadsheet omits trailing empty cells — so the
 * missing ones must paste as blanks instead of shifting the row's contents left.
 */
export function cellAt(
	rows: readonly (readonly string[])[],
	row: number,
	column: number,
): string {
	return rows[row]?.[column] ?? '';
}
