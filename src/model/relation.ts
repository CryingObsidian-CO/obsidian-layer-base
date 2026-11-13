import type { CellValue, Field, LayerDoc, LayerRecord } from '../types';
import { formatCell, relationIds } from './fields';

/**
 * The document cannot read every column: a formula is computed and a relation holds ids
 * where the cell shows names, so the caller that can see that table supplies the text.
 */
export type CellReader = (field: Field, record: LayerRecord) => string;

export interface BacklinkRow {
	record: LayerRecord;
	/** Its 1-based position, which names it when there is no title column. */
	position: number;
}

export interface RelationCandidate {
	recordId: string;
	text: string;
}

export interface RelationText {
	texts: string[];
	broken: number;
}

function linkedField(target: LayerDoc, fieldId: string): Field | undefined {
	return target.fields.find((field) => field.id === fieldId);
}

/** Rows whose linked cell holds nothing are left out rather than offered as blanks. */
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
 * With no column configured the cell reads as the row numbers of the rows it points at,
 * which beats identifiers and still tells the rows apart.
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
 * Each value is read through the formatter of the column it came from, not through
 * `relationText`, which expects a cell of row ids and answers nothing for a plain value,
 * which looks exactly like an empty column. A value reading as blank contributes no chip.
 */
export function lookupChips(
	column: Field,
	values: readonly CellValue[],
	/** Only the view can read a column that points at other rows: the names live in another table. */
	readLinks?: (column: Field, value: CellValue) => readonly string[],
	/**
	 * What each value reads as, `null` where this module reads it itself. A computed column
	 * stores nothing to format, so without this it contributes no chip.
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
 * Built once and reused for every cell of the column: per cell it would scan the source
 * table per row. `null` differs from an empty map: the source column is missing or is not
 * a relation, rather than nobody pointing anywhere.
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
	// A deleted display column falls back to row numbers: the links themselves are still sound.
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

/** One scan answers both questions asked of the index: what a backlink cell reads, and what a rollup gathers. */
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
 * Obsidian hands the old and new path over on rename, which is the only way a rename can
 * be followed at all. Only open documents are corrected: the fix reaches disk with their next save.
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
		if (field.type === 'relationBack' && field.backPath === oldPath) {
			field.backPath = newPath;
			repaired++;
		}
	}
	return repaired;
}
