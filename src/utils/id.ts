let counter = 0;

/**
 * A short run of random base36 characters, from the platform's own randomness.
 *
 * `Math.random` only stands in where the platform has no `crypto`; these strings
 * are storage keys, so weak randomness is the difference between a key and a guess.
 */
function randomTail(length: number): string {
	const bytes = new Uint8Array(length);
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		crypto.getRandomValues(bytes);
	} else {
		for (let index = 0; index < length; index += 1) {
			bytes[index] = Math.floor(Math.random() * 256);
		}
	}
	let tail = '';
	for (const byte of bytes) {
		tail += (byte % 36).toString(36);
	}
	return tail;
}

/**
 * A new id for a record, a column, an option or a view.
 *
 * The timestamp and the counter only make an id unique within one run of this
 * code: the counter starts again at zero after a reload, and a second process —
 * the MCP server, another window, a test run — counts on its own. Two of them
 * writing in the same millisecond reach the same counter step and would produce
 * the same string, and a string like this is the key that says where a cell's
 * value is stored: a duplicate is not a near miss, it is two rows sharing one cell.
 * The random tail is what keeps them apart.
 */
export function generateId(prefix: string): string {
	counter = (counter + 1) % 0xffff;
	const time = Date.now().toString(36);
	const seq = counter.toString(36).padStart(3, '0');
	return `${prefix}_${time}${seq}${randomTail(6)}`;
}
