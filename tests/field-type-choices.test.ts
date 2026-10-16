import { describe, expect, it } from 'vitest';
import {
	fieldTypeMatches,
	type FieldTypeChoice,
} from '../src/ui/field-type-choices';

const choice = (over: Partial<FieldTypeChoice> = {}): FieldTypeChoice => ({
	type: 'text',
	label: '文本',
	hint: '单行文本',
	...over,
});

describe('matches', () => {
	it('matches everything on an empty query', () => {
		expect(fieldTypeMatches(choice(), '')).toBe(true);
	});

	it('matches everything on a whitespace-only query', () => {
		expect(fieldTypeMatches(choice(), '   ')).toBe(true);
	});

	it('finds a substring of the label', () => {
		expect(fieldTypeMatches(choice({ label: '单选' }), '选')).toBe(true);
	});

	it('ignores case in the label', () => {
		expect(fieldTypeMatches(choice({ label: 'Text' }), 'text')).toBe(true);
		expect(fieldTypeMatches(choice({ label: 'Text' }), 'TEXT')).toBe(true);
	});

	it('ignores surrounding whitespace in the query', () => {
		expect(fieldTypeMatches(choice({ label: '单选' }), '  选  ')).toBe(true);
	});

	it('does not match a label that does not contain the query', () => {
		expect(fieldTypeMatches(choice({ label: '文本' }), 'zzz')).toBe(false);
	});

	// The hint is shown on the row but must not make the row findable.
	it('does not match through the hint', () => {
		const text = choice({ label: '文本', hint: '单行文本' });

		expect(fieldTypeMatches(text, '单')).toBe(false);
	});

	it('lets a query match one type by name without pulling in another by hint', () => {
		const text = choice({ label: '文本', hint: '单行文本' });
		const select = choice({ type: 'select', label: '单选', hint: '从列表中选择一项' });

		expect([text, select].filter((c) => fieldTypeMatches(c, '单'))).toEqual([select]);
	});
});
