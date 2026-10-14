let counter = 0;

/**
 * Short, collision-resistant id used for fields, options, records and views.
 *
 * Ids only need to be unique inside one file, so a timestamp plus a counter is
 * enough and stays readable when someone inspects the JSON by hand.
 */
export function generateId(prefix: string): string {
	counter = (counter + 1) % 0xffff;
	const time = Date.now().toString(36);
	const seq = counter.toString(36).padStart(3, '0');
	return `${prefix}_${time}${seq}`;
}