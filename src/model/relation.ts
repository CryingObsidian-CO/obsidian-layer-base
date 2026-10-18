import type { CellValue, Field, LayerDoc } from '../types';
import { formatCell, relationIds } from './fields';

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
): RelationCandidate[] {
	const field = linkedField(target, fieldId);
	if (!field) {
		return [];
	}
	const candidates: RelationCandidate[] = [];
	for (const record of target.records) {
		const text = formatCell(field, record.cells[fieldId] ?? '');
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
		const text = formatCell(field, record.cells[fieldId] ?? '');
		if (text !== '') {
			texts.push(text);
		}
	}
	return { texts, broken };
}

/** Whether a table can be the target of a relation: it must have columns. */
export function canLinkTo(target: LayerDoc): boolean {
	return target.fields.length > 0;
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
): Map<string, string[]> | null {
	const field = source.fields.find((candidate) => candidate.id === sourceFieldId);
	if (!field || field.type !== 'relation') {
		return null;
	}
	// A display column that was deleted falls back to row numbers rather than
	// breaking the column: the links themselves are still sound.
	const titleField = source.fields.find(
		(candidate) => candidate.id === titleFieldId,
	);
	const index = new Map<string, string[]>();
	for (const [position, record] of source.records.entries()) {
		const ids = relationIds(record.cells[sourceFieldId] ?? '');
		if (ids.length === 0) {
			continue;
		}
		// The name is worked out only for rows that point somewhere.
		const title = titleField
			? formatCell(titleField, record.cells[titleField.id] ?? '')
			: String(position + 1);
		for (const id of ids) {
			const existing = index.get(id);
			if (existing) {
				existing.push(title);
			} else {
				index.set(id, [title]);
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
): RelationText {
	if (source === null) {
		return { texts: [], broken: 1 };
	}
	const index = relationBackIndex(source, sourceFieldId, titleFieldId);
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
