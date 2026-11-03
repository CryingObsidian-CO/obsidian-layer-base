import type { Field, LayerDoc } from '../types';
import { padNumber, paddingOf } from './auto-number';
import { formatCell } from './fields';

/**
 * The number each row shows, by row id.
 *
 * A number is a position, not a value: every row is counted within its group, in
 * the order the rows are stored, so the count runs 1..n with no gaps and nothing
 * is written to the file. That is also why nothing is issued when a row is
 * created — a row inserted in the middle shifts the ones after it, which reads as
 * what it is ("the third one now") rather than as a stale statement about the
 * past.
 *
 * The order is the stored one and not the view's: the same row keeps the same
 * number however the table is sorted or filtered, and numbering never becomes a
 * property of one view.
 *
 * Grouping reads the group column through `formatCell`, so two rows showing the
 * same choice count together even though they store the same id, and a row with
 * no group counts on its own.
 */
export function numberTexts(doc: LayerDoc, field: Field): Map<string, string> {
	const groupField = doc.fields.find(
		(other) => other.id === (field.numberGroupFieldId ?? ''),
	);
	const width = paddingOf(field);
	const counted = new Map<string, number>();
	const texts = new Map<string, string>();
	for (const record of doc.records) {
		const group =
			groupField === undefined
				? ''
				: formatCell(groupField, record.cells[groupField.id] ?? '');
		const next = (counted.get(group) ?? 0) + 1;
		counted.set(group, next);
		texts.set(record.id, padNumber(next, width));
	}
	return texts;
}
