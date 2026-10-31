import { describe, expect, it } from 'vitest';
import { noteLabel } from '../src/model/note-path';

describe('noteLabel', () => {
	it('shows the file name alone by default', () => {
		expect(noteLabel('folder/note', 'name')).toBe('note');
		expect(noteLabel('note', 'name')).toBe('note');
	});

	it('drops the extension in both styles', () => {
		expect(noteLabel('folder/note.md', 'name')).toBe('note');
		expect(noteLabel('folder/note.md', 'path')).toBe('folder/note');
	});

	it('keeps the folder when the whole path is asked for', () => {
		expect(noteLabel('a/b/note', 'path')).toBe('a/b/note');
	});

	it('reads a leading slash as a folder boundary', () => {
		expect(noteLabel('/note', 'name')).toBe('note');
	});

	it('answers an empty value with an empty label', () => {
		expect(noteLabel('', 'name')).toBe('');
	});
});
