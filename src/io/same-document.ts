import type {LayerDoc} from '../types';

/** Whether two documents hold the same thing. Recognises this view's own save coming back so undo
 * steps are not thrown away. Everything the reader can change counts — rows, columns, the document's
 * name, its views — and a document read back from its own write matches as a whole. */
export function sameDocument(a: LayerDoc, b: LayerDoc): boolean {
	return stableJson(a) === stableJson(b);
}

/** JSON with object members sorted, so two equal documents serialize the same. Array order is kept:
 * it is the order of the columns and rows, which the reader does change. */
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
