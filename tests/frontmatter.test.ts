import { describe, expect, it } from 'vitest';
import { frontmatterValue } from '../mcp/frontmatter';

const note = (body: string): string => `---\n${body}\n---\nA note body.`;

describe('reading a note property from frontmatter', () => {
	it('reads plain scalars and strips quotes', () => {
		expect(frontmatterValue(note('status: done'), 'status')).toBe('done');
		expect(frontmatterValue(note('status: "in progress"'), 'status')).toBe('in progress');
	});

	it('drops a comment that follows a quoted value', () => {
		expect(frontmatterValue(note('status: "done" # note'), 'status')).toBe('done');
		expect(frontmatterValue(note("note: 'it''s' # x"), 'note')).toBe("it's");
	});

	it('decodes a quoted value once, so an escaped backslash stays one', () => {
		expect(frontmatterValue(note('path: "C:\\\\new"'), 'path')).toBe('C:\\new');
		expect(frontmatterValue(note('text: "a\\\\nb"'), 'text')).toBe('a\\nb');
		expect(frontmatterValue(note('line: "one\\ntwo"'), 'line')).toBe('one\ntwo');
	});

	it('reads inline and block arrays as comma-separated text', () => {
		expect(frontmatterValue(note('tags: [a, b, "c d"]'), 'tags')).toBe('a, b, c d');
		expect(frontmatterValue(note('tags:\n  - a\n  - b'), 'tags')).toBe('a, b');
	});

	it('reads a folded block as one line', () => {
		expect(frontmatterValue(note('summary: >\n  first\n  second'), 'summary')).toBe(
			'first second',
		);
	});

	it('keeps a block scalar past a blank line, and stops at the next key', () => {
		const body = 'summary: |\n  first\n\n  second\nnext: x';
		expect(frontmatterValue(note(body), 'summary')).toBe('first\n\nsecond');
		expect(frontmatterValue(note(body), 'next')).toBe('x');
	});

	it('answers empty for a missing key and null for a nested mapping', () => {
		expect(frontmatterValue(note('owner:\n  name: Ada'), 'owner')).toBeNull();
		expect(frontmatterValue(note('status: done'), 'missing')).toBe('');
	});

	it('answers empty when the note has no frontmatter', () => {
		expect(frontmatterValue('Just text', 'status')).toBe('');
	});
});
