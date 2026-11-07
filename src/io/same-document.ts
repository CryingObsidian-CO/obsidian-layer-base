import type {LayerDoc} from '../types';

/**
 * Whether two documents hold the same thing.
 *
 * Used to recognise this view's own save coming back from the file, so the undo
 * steps are not thrown away for a change nobody made. Everything the reader can
 * change counts: rows and columns, but also the document's name and its views.
 * Comparing rows and columns alone treated an outside rename — of the document, of
 * a view, of a filter or a board setting — as that echo: the incoming document was
 * discarded, and the next save wrote this view's stale copy back over it.
 *
 * A document read back from its own write matches as a whole, creation stamps and
 * filled-in defaults included, so nothing has to be left out of the comparison.
 * Key order does not count, so a member written back in another order still reads
 * as the same document.
 */
export function sameDocument(a: LayerDoc, b: LayerDoc): boolean {
	return stableJson(a) === stableJson(b);
}

/**
 * JSON with object members in a fixed order, so two equal documents serialize the
 * same way whatever order their keys happen to sit in. Array order is kept: it is
 * the order of the columns and the rows, which the reader does change.
 */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) => {
		if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
			return inner;
		}
		const record = inner as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			sorted[key] = record[key];
		}
		return sorted;
	});
}
