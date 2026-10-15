export function parseGrid(text: string): string[][] {
	const body = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
	return body.split('\n').map((line) => line.split('\t'));
}

export function formatGrid(rows: readonly (readonly string[])[]): string {
	return rows.map((row) => row.join('\t')).join('\n');
}

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

export function cellAt(
	rows: readonly (readonly string[])[],
	row: number,
	column: number,
): string {
	return rows[row]?.[column] ?? '';
}
