/**
 * The small YAML subset a note property needs.
 *
 * Obsidian's metadata cache is not available to the MCP server, which runs as a
 * separate Node process. A note property normally points at one top-level key,
 * so this reads that key from a frontmatter block without pretending to be a
 * general YAML parser: scalars, quoted strings, inline arrays and simple block
 * arrays work; a nested mapping reads as empty, and the caller tells the reader
 * that this column only carries simple values.
 */

/** The text between the two `---` fences, or null when the note has none. */
function frontmatterBlock(text: string): string | null {
	const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(withoutBom);
	return match?.[1] ?? null;
}

/** A key as YAML readers write it: plain, or wrapped in quotes. */
function keyOf(line: string): { key: string; value: string } | null {
	const match = /^([^\s:#][^:]*?)\s*:\s*(.*)$/.exec(line);
	if (!match) {
		return null;
	}
	let key = match[1]?.trim() ?? '';
	if (
		(key.startsWith('"') && key.endsWith('"')) ||
		(key.startsWith("'") && key.endsWith("'"))
	) {
		key = key.slice(1, -1);
	}
	return { key, value: match[2] ?? '' };
}

/** A scalar as a person reads it, with quotes and simple escapes removed. */
function scalar(text: string): string {
	let value = text.trim();
	if (value === '' || value === '~' || value.toLowerCase() === 'null') {
		return '';
	}
	const quote = value[0];
	if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
		value = value.slice(1, -1);
		if (quote === '"') {
			value = value
				.replace(/\\n/g, '\n')
				.replace(/\\"/g, '"')
				.replace(/\\\\/g, '\\');
		} else {
			value = value.replace(/''/g, "'");
		}
		return value;
	}
	// A trailing comment starts at a # preceded by whitespace; a # inside a
	// quoted string was handled above.
	const comment = value.search(/\s#/);
	if (comment !== -1) {
		value = value.slice(0, comment).trim();
	}
	return value;
}

/** An inline list, split on commas that are not inside quotes. */
function inlineList(text: string): string[] {
	const body = text.trim().replace(/^\[/, '').replace(/\]$/, '');
	const parts: string[] = [];
	let current = '';
	let quote = '';
	for (const char of body) {
		if (quote !== '') {
			current += char;
			if (char === quote) {
				quote = '';
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === ',') {
			if (current.trim() !== '') {
				parts.push(scalar(current));
			}
			current = '';
			continue;
		}
		current += char;
	}
	if (current.trim() !== '') {
		parts.push(scalar(current));
	}
	return parts.filter((part) => part !== '');
}

/**
 * The value of one top-level frontmatter key.
 *
 * A missing note, a missing key and a value this subset cannot read all answer
 * empty; the caller is responsible for saying that only simple frontmatter values
 * are read rather than turning an unsupported object into a quiet blank.
 */
export function frontmatterValue(text: string, key: string): string {
	const block = frontmatterBlock(text);
	if (block === null) {
		return '';
	}
	const lines = block.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (line.startsWith(' ') || line.startsWith('\t')) {
			continue;
		}
		const entry = keyOf(line);
		if (entry === null || entry.key !== key) {
			continue;
		}
		let value = entry.value.trim();
		if (value === '') {
			// A value on the following indented lines is either a block list or a
			// nested mapping. Lists become comma-separated text; mappings stay empty.
			const items: string[] = [];
			let nestedMapping = false;
			for (let next = index + 1; next < lines.length; next += 1) {
				const following = lines[next] ?? '';
				if (following.trim() === '') {
					continue;
				}
				if (!following.startsWith(' ') && !following.startsWith('\t')) {
					break;
				}
				const trimmed = following.trim();
				if (trimmed.startsWith('- ')) {
					items.push(scalar(trimmed.slice(2)));
				} else if (trimmed !== '') {
					nestedMapping = true;
				}
			}
			return nestedMapping && items.length === 0 ? '' : items.join(', ');
		}
		if (value.startsWith('|') || value.startsWith('>')) {
			const folded = value.startsWith('>');
			const collected: string[] = [];
			for (let next = index + 1; next < lines.length; next += 1) {
				const following = lines[next] ?? '';
				if (!following.startsWith(' ') && !following.startsWith('\t')) {
					break;
				}
				collected.push(following.replace(/^[ \t]+/, ''));
			}
			return collected.join(folded ? ' ' : '\n').trim();
		}
		if (value.startsWith('[') && value.endsWith(']')) {
			return inlineList(value).join(', ');
		}
		if (value.startsWith('{') && value.endsWith('}')) {
			return '';
		}
		return scalar(value);
	}
	return '';
}
