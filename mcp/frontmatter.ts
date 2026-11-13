/* The frontmatter subset a note property needs: no metadata cache is available to
 * the MCP server, so this reads one top-level key without being a general YAML
 * parser. A nested mapping reads as `null`, which the caller reports as unreadable. */

function frontmatterBlock(text: string): string | null {
	const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(withoutBom);
	return match?.[1] ?? null;
}

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

function scalar(text: string): string {
	let value = text.trim();
	if (value === '' || value === '~' || value.toLowerCase() === 'null') {
		return '';
	}
	const quote = value[0];
	if (quote === '"' || quote === "'") {
		// A comment may follow the closing quote (`status: "done" # note`); trim it,
		// or the value no longer ends in its quote.
		const comment = value.search(/\s#/);
		if (comment !== -1 && value[comment - 1] === quote) {
			value = value.slice(0, comment).trim();
		}
		if (value.endsWith(quote)) {
			value = value.slice(1, -1);
			if (quote === '"') {
				// One pass left to right, each backslash read once: matching `\n` before
				// `\\` turns the second backslash of `C:\\new` into a line break.
				value = value.replace(/\\(["\\n])/g, (_match: string, char: string) =>
					char === 'n' ? '\n' : char,
				);
			} else {
				value = value.replace(/''/g, "'");
			}
			return value;
		}
	}
	// A trailing comment starts at whitespace followed by #.
	const comment = value.search(/\s#/);
	if (comment !== -1) {
		value = value.slice(0, comment).trim();
	}
	return value;
}

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
 * A missing note, key or value answers `''`; `null` means the key exists but reads as
 * a nested mapping, which the caller must report as unreadable rather than empty.
 */
export function frontmatterValue(text: string, key: string): string | null {
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
			// An indented value is a block list or a nested mapping: lists become
			// comma-separated text, mappings stay empty.
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
			return nestedMapping ? null : items.join(', ');
		}
		if (value.startsWith('|') || value.startsWith('>')) {
			const folded = value.startsWith('>');
			const collected: string[] = [];
			for (let next = index + 1; next < lines.length; next += 1) {
				const following = lines[next] ?? '';
				if (following.trim() === '') {
					// A blank line inside the block is a paragraph break, not its end.
					collected.push('');
					continue;
				}
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
			return null;
		}
		return scalar(value);
	}
	return '';
}
