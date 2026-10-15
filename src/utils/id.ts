let counter = 0;

export function generateId(prefix: string): string {
	counter = (counter + 1) % 0xffff;
	const time = Date.now().toString(36);
	const seq = counter.toString(36).padStart(3, '0');
	return `${prefix}_${time}${seq}`;
}
