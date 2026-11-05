import { describe, expect, it } from 'vitest';
import { csvField, csvFileName, csvLine, toCsv } from '../src/model/csv';

describe('writing one field', () => {
	it('leaves a plain value bare, so the file stays readable', () => {
		expect(csvField('hello')).toBe('hello');
		expect(csvField('2026-10-18')).toBe('2026-10-18');
	});

	it('quotes a value holding a comma, which would otherwise split the cell', () => {
		expect(csvField('a,b')).toBe('"a,b"');
	});

	it('doubles an inner quote, which is how the format escapes it', () => {
		expect(csvField('say "hi"')).toBe('"say ""hi"""');
	});

	it('quotes a value holding a line break, which would otherwise end the row', () => {
		expect(csvField('one\ntwo')).toBe('"one\ntwo"');
		expect(csvField('one\r\ntwo')).toBe('"one\r\ntwo"');
	});

	it('keeps a value that is only a quote', () => {
		expect(csvField('"')).toBe('""""');
	});
});

describe('writing lines and files', () => {
	it('joins fields with commas and ends the line the format way', () => {
		// CRLF because that is what the format specifies.
		expect(csvLine(['a', 'b c'])).toBe('a,b c\r\n');
	});

	it('writes a header and one line per row', () => {
		const text = toCsv(['Name', 'Total'], [['Ann', '3'], ['Bo', '5']]);
		expect(text).toContain('Name,Total\r\n');
		expect(text).toContain('Ann,3\r\n');
		expect(text).toContain('Bo,5\r\n');
	});

	it('starts with a byte-order mark so a spreadsheet reads the text right', () => {
		// Without it Excel mangles Chinese, which these boards are routinely written in.
		expect(toCsv(['名称'], [['张三']]).startsWith('\uFEFF')).toBe(true);
	});

	it('writes the header even for an empty table', () => {
		expect(toCsv(['A', 'B'], [])).toBe('\uFEFFA,B\r\n');
	});
});

describe('naming the file', () => {
	it('uses the board name with a csv suffix', () => {
		expect(csvFileName('Tasks')).toBe('Tasks.csv');
	});

	it('replaces characters a file system refuses', () => {
		expect(csvFileName('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i.csv');
	});

	it('falls back to something rather than ending up with only a suffix', () => {
		expect(csvFileName('   ')).toBe('export.csv');
	});

	it('drops an ending that would land as two dots', () => {
		expect(csvFileName('foo.')).toBe('foo.csv');
		expect(csvFileName('foo . .')).toBe('foo.csv');
	});

	it('falls back when the name is nothing but dots', () => {
		// Both would start the file name with the dot that hides it on macOS.
		expect(csvFileName('..')).toBe('export.csv');
		expect(csvFileName('.')).toBe('export.csv');
	});

	it('keeps a long name inside what a file system accepts', () => {
		const name = csvFileName('x'.repeat(400));
		expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(204);
		expect(name.endsWith('.csv')).toBe(true);
	});

	it('counts bytes, so a name of wide characters is cut sooner', () => {
		const name = csvFileName('表'.repeat(200));
		expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(204);
		expect(name.endsWith('.csv')).toBe(true);
	});

	it('never cuts a character in half', () => {
		// Four bytes each, so the budget lands exactly on fifty of them.
		expect(csvFileName('🎉'.repeat(100))).toBe(`${'🎉'.repeat(50)}.csv`);
	});
});
