import {isDerived} from '../../model/fields';
import type {Field} from '../../types';

/**
 * The columns a fill-down may write: a derived column stores nothing, so filling from its cell
 * pushes the empty value down — for a `noteProp` that deletes the key from every linked note.
 * Asked of `isDerived` rather than `isReadOnly`: a note property is editable yet stores nothing.
 */
export function fillableFields(fields: readonly Field[]): Field[] {
	return fields.filter((field) => !isDerived(field.type));
}
