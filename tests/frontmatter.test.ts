import { describe, expect, it } from 'vitest';
import { frontmatterValue } from '../mcp/frontmatter';

const note = (body: string): string => `---\n${body}\n---\nA note body.`;

describe('reading a note property from frontmatter', () => {
	it('reads plain scalars and strips quotes', () => {
		expect(frontmatterValue(note('status: done'), 'status')).toBe('done');
		expect(frontmatterValue(note('status: "in progress"'), 'status')).toBe('in progress');
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

	it('answers empty for a nested mapping or a missing key', () => {
		expect(frontmatterValue(note('owner:\n  name: Ada'), 'owner')).toBe('');
		expect(frontmatterValue(note('status: done'), 'missing')).toBe('');
	});

	it('answers empty when the note has no frontmatter', () => {
		expect(frontmatterValue('Just text', 'status')).toBe('');
	});
});
