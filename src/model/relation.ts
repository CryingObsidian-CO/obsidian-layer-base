import type { CellValue, Field, LayerDoc, LayerRecord } from '../types';
import { formatCell, relationIds } from './fields';

/**
 * How a cell of another table reads as text.
 *
 * The document cannot answer this for every column: a formula is computed and a
 * relation holds ids where the cell shows names. So the caller that can see that
 * table supplies the answer; a caller with none gets the stored value, which is
 * right for every type that stores what it shows.
 */
export type CellReader = (field: Field, record: LayerRecord) => string;

/** One row that points at another, with where it sits in its own table. */
export interface BacklinkRow {
	record: LayerRecord;
	/** Its 1-based position, which names it when there is no title column. */
	position: number;
}

/** One row of the target table that a relation cell may point at. */
export interface RelationCandidate {
	recordId: string;
	/** The value that row holds in the linked column — what the cell will show. */
	text: string;
}

export interface RelationText {
	/** The values this cell points at, one per referenced row. */
	texts: string[];
	/** How many of the referenced rows could not be found. */
	broken: number;
}

/** The column a relation reads, when the target table still has it. */
function linkedField(target: LayerDoc, fieldId: string): Field | undefined {
	return target.fields.find((field) => field.id === fieldId);
}

/**
 * The rows worth offering as a choice: those whose cell in the linked column
 * holds something. A row with nothing there has no value to contribute, so it is
 * left out rather than listed as a blank.
 */
export function relationCandidates(
	target: LayerDoc,
	fieldId: string,
	read?: CellReader,
): RelationCandidate[] {
	const field = linkedField(target, fieldId);
	if (!field) {
		return [];
	}
	const candidates: RelationCandidate[] = [];
	for (const record of target.records) {
		const text = read
			? read(field, record)
			: formatCell(field, record.cells[fieldId] ?? '');
		if (text !== '') {
			candidates.push({ recordId: record.id, text });
		}
	}
	return candidates;
}

/**
 * What a relation cell reads as: the values it points at, and how many of the
 * rows it names are gone.
 *
 * With no column configured the cell reads as the row numbers of the rows it
 * points at, which is the honest answer when nothing has been chosen to show —
 * better than identifiers, and still enough to tell the rows apart.
 */
export function relationText(
	target: LayerDoc,
	fieldId: string,
	value: CellValue,
	read?: CellReader,
): RelationText {
	const ids = relationIds(value);
	if (fieldId === '') {
		const numbers: string[] = [];
		let missing = 0;
		for (const id of ids) {
			const position = target.records.findIndex((row) => row.id === id);
			if (position === -1) {
				missing++;
			} else {
				numbers.push(String(position + 1));
			}
		}
		return { texts: numbers, broken: missing };
	}

	const field = linkedField(target, fieldId);
	if (!field) {
		return { texts: [], broken: ids.length };
	}
	const texts: string[] = [];
	let broken = 0;
	for (const id of ids) {
		const record = target.records.find((row) => row.id === id);
		if (!record) {
			broken++;
			continue;
		}
		const text = read
			? read(field, record)
			: formatCell(field, record.cells[fieldId] ?? '');
		if (text !== '') {
			texts.push(text);
		}
	}
	return { texts, broken };
}

/**
 * The values a lookup shows, one chip per value gathered from a linked row.
 *
 * Each value is read through the formatter of the column it came from, so a
 * choice shows its name rather than the id it stores and a number keeps its
 * format. It must not go through `relationText`: that reads a cell holding a list
 * of row ids, and a plain value is not one — it answers with nothing, which looks
 * exactly like an empty column.
 *
 * A value that reads as blank contributes no chip: an empty pill would be a
 * value the cell does not really hold.
 */
export function lookupChips(
	column: Field,
	values: readonly CellValue[],
	/**
	 * How to read a column that itself points at other rows. Only the view can
	 * answer that, because the names live in another table; without it such a
	 * column falls back to what it stores, which is its row ids.
	 */
	readLinks?: (column: Field, value: CellValue) => readonly string[],
	/**
	 * What each value reads as, one entry per value, `null` where this module should
	 * read it itself. A column that computes its own text stores nothing to format,
	 * so without this it contributes no chip at all — the lookup showed a blank where
	 * the other table plainly held a value.
	 */
	resolved?: readonly (string | null)[],
): string[] {
	const chips: string[] = [];
	for (const [index, value] of values.entries()) {
		const texts =
			column.type === 'relation' && readLinks !== undefined
				? readLinks(column, value)
				: [resolved?.[index] ?? formatCell(column, value)];
		for (const text of texts) {
			if (text.trim() !== '') {
				chips.push(text);
			}
		}
	}
	return chips;
}

/**
 * Which rows point at each row of the target table, built in one pass.
 *
 * Built once and reused for every cell of the column: asking the same question
 * per cell would scan the whole source table once per row, which is quadratic
 * and enough to make a board unusable.
 *
 * `titleFieldId` is the column a pointing row is named by; when it is empty the
 * row's own number is used. `null` means the question cannot be answered at all
 * — the source column is missing, or is not a relation — which is different from
 * an empty map, where nobody points anywhere.
 */
export function relationBackIndex(
	source: LayerDoc,
	sourceFieldId: string,
	titleFieldId: string,
	read?: CellReader,
): Map<string, string[]> | null {
	const rows = relationBackRows(source, sourceFieldId);
	if (rows === null) {
		return null;
	}
	// A display column that was deleted falls back to row numbers rather than
	// breaking the column: the links themselves are still sound.
	const titleField = source.fields.find(
		(candidate) => candidate.id === titleFieldId,
	);
	const index = new Map<string, string[]>();
	for (const [id, pointing] of rows) {
		index.set(
			id,
			pointing.map(({ record, position }) =>
				titleField
					? read
						? read(titleField, record)
						: formatCell(titleField, record.cells[titleField.id] ?? '')
					: String(position),
			),
		);
	}
	return index;
}

/**
 * The rows that point at each row of this table, by the row they point at.
 *
 * One scan answers both questions asked of it: what a backlink cell reads as, and
 * what a rollup should gather.
 */
export function relationBackRows(
	source: LayerDoc,
	sourceFieldId: string,
): Map<string, BacklinkRow[]> | null {
	const field = source.fields.find((candidate) => candidate.id === sourceFieldId);
	if (!field || field.type !== 'relation') {
		return null;
	}
	const index = new Map<string, BacklinkRow[]>();
	for (const [position, record] of source.records.entries()) {
		const ids = relationIds(record.cells[sourceFieldId] ?? '');
		if (ids.length === 0) {
			continue;
		}
		const row: BacklinkRow = { record, position: position + 1 };
		for (const id of ids) {
			const existing = index.get(id);
			if (existing) {
				existing.push(row);
			} else {
				index.set(id, [row]);
			}
		}
	}
	return index;
}

/**
 * What a reverse relation reads as on one row: the titles of the rows that point
 * at it.
 *
 * Nothing is stored for these cells — the answer is worked out from the other
 * table every time it is asked for, so it cannot drift out of step with the
 * links it describes.
 */
export function relationBackText(
	source: LayerDoc | null,
	sourceFieldId: string,
	targetRecordId: string,
	titleFieldId = '',
	read?: CellReader,
): RelationText {
	if (source === null) {
		return { texts: [], broken: 1 };
	}
	const index = relationBackIndex(source, sourceFieldId, titleFieldId, read);
	if (index === null) {
		return { texts: [], broken: 1 };
	}
	return { texts: index.get(targetRecordId) ?? [], broken: 0 };
}

/**
 * Points every relation at a renamed table to its new path, and says how many
 * were corrected.
 *
 * The name matters: Obsidian hands the old and new path over on rename, which is
 * exact — better than matching filenames afterwards, and the only way a rename
 * (rather than a move) can be followed at all. Applied to the documents that are
 * open, so the correction reaches the disk with their next save and no file is
 * written that nobody is editing.
 */
export function repairRelationPaths(
	doc: LayerDoc,
	oldPath: string,
	newPath: string,
): number {
	let repaired = 0;
	for (const field of doc.fields) {
		if (field.type === 'relation' && field.linkPath === oldPath) {
			field.linkPath = newPath;
			repaired++;
		}
		// A reverse field names a table too, and follows it the same way.
		if (field.type === 'relationBack' && field.backPath === oldPath) {
			field.backPath = newPath;
			repaired++;
		}
	}
	return repaired;
}
