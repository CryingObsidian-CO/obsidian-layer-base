import type { Field, LayerDoc } from '../types';
import { padNumber, paddingOf } from './auto-number';
import { formatCell } from './fields';

/** The number each row shows, by row id. A number is a position, not a value: rows are counted within
 * their group in stored order, so sorting or filtering does not renumber and nothing is written to
 * the file. Grouping compares formatted values, so rows showing the same choice count together. */
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
