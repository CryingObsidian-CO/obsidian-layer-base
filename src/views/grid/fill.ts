import {isDerived} from '../../model/fields';
import type {Field} from '../../types';

/**
 * The columns of a range a fill-down may write.
 *
 * A derived column keeps nothing in the record, so the value behind its cell is the
 * empty stored one rather than what the column shows. Filling from that cell pushes
 * the empty value into the rows below: for a note property it reaches the note and
 * deletes the frontmatter key from every linked note — a real loss — while the
 * computed kinds only refuse the write after it is attempted, leaving a warning and
 * a whole-view repaint behind each one.
 *
 * Asked of `isDerived` rather than `isReadOnly` because a note property is editable
 * and still stores nothing here: it is the one derived column a reader can type
 * into, and so the one this has to catch.
 *
 * Order is the range's own, so what remains is filled left to right.
 */
export function fillableFields(fields: readonly Field[]): Field[] {
	return fields.filter((field) => !isDerived(field.type));
}
