let counter = 0;

/** Base36 randomness from the platform: these strings are storage keys, so `Math.random` is only a
 * stand-in where `crypto` is missing. */
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

/** A new id. The timestamp and counter only sort within one run, so the random tail keeps a second
 * process from producing the same pair in the same millisecond — a duplicate id is two rows sharing
 * a cell. */
export function generateId(prefix: string): string {
	counter = (counter + 1) % 0xffff;
	const time = Date.now().toString(36);
	const seq = counter.toString(36).padStart(3, '0');
	return `${prefix}_${time}${seq}${randomTail(6)}`;
}
