import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearClipboardBuffer,
	copyFormatted,
	readFormatted,
	readText,
} from '../src/model/clipboard';
import type { FormattedClipboard } from '../src/model/clipboard';

const PAYLOAD: FormattedClipboard = {
	text: 'a\tb\nc\td',
	rows: [
		[
			{ type: 'text', value: 'a', text: 'a' },
			{ type: 'text', value: 'b', text: 'b' },
		],
		[
			{ type: 'text', value: 'c', text: 'c' },
			{ type: 'text', value: 'd', text: 'd' },
		],
	],
};

/**
 * The system clipboard, stood in for by a variable a test owns outright.
 * `null` is the state of a clipboard that holds nothing.
 */
let system: string | null = null;
/** Whether the browser refuses clipboard access, as it does without a gesture. */
let denied = false;

beforeEach(() => {
	clearClipboardBuffer();
	system = null;
	denied = false;
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.stubGlobal('navigator', {
		clipboard: {
			readText: async () => {
				if (denied) {
					throw new Error('denied');
				}
				return system ?? '';
			},
			writeText: async (text: string) => {
				if (denied) {
					throw new Error('denied');
				}
				system = text;
			},
		},
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	clearClipboardBuffer();
});

describe('the buffered payload survives a round trip', () => {
	it('hands back the structured rows after its own copy', async () => {
		await copyFormatted(PAYLOAD);

		expect(await readFormatted()).toEqual(PAYLOAD);
	});

	it('still hands it back when the clipboard cannot be read back', async () => {
		// The check exists to catch someone else's copy landing on top. If the
		// check cannot run, the payload is still the newest thing we wrote.
		await copyFormatted(PAYLOAD);
		denied = true;

		expect(await readFormatted()).toEqual(PAYLOAD);
	});

	it('reports nothing to paste before anything was copied', async () => {
		expect(await readFormatted()).toBeNull();
	});
});

describe('a payload the user has since replaced is dropped', () => {
	it('refuses the payload once the clipboard holds other text', async () => {
		await copyFormatted(PAYLOAD);
		system = 'something else entirely';

		expect(await readFormatted()).toBeNull();
	});

	it('falls back to reading the new text as plain values', async () => {
		// The stale payload is gone, but the text that replaced it is still
		// pasteable — dropping to text is the right answer, not nothing.
		await copyFormatted(PAYLOAD);
		system = 'x\ty';

		expect(await readFormatted()).toBeNull();
		expect(await readText()).toBe('x\ty');
	});

	it('treats an emptied clipboard as nothing at all', async () => {
		await copyFormatted(PAYLOAD);
		system = '';

		expect(await readFormatted()).toBeNull();
		expect(await readText()).toBeNull();
	});

	it('does not offer the payload a second time after dropping it', async () => {
		await copyFormatted(PAYLOAD);
		system = 'something else entirely';
		await readFormatted();

		expect(await readFormatted()).toBeNull();
	});
});

describe('plain text reading', () => {
	it('reports nothing to paste from an empty clipboard', async () => {
		expect(await readText()).toBeNull();
	});

	it('reads text the plugin never wrote', async () => {
		system = 'pasted from elsewhere';

		expect(await readText()).toBe('pasted from elsewhere');
	});

	it('reports nothing when the clipboard refuses to be read', async () => {
		denied = true;

		expect(await readText()).toBeNull();
	});
});

describe('a clipboard that cannot be written to', () => {
	it('still keeps the payload for pasting inside the plugin', async () => {
		// Copying to the system clipboard is best-effort: on a platform that
		// refuses it, a copy followed by a paste must still work.
		denied = true;

		await expect(copyFormatted(PAYLOAD)).resolves.toBeUndefined();
		expect(await readText()).toBe(PAYLOAD.text);
	});

	it('says why, rather than failing the copy silently', async () => {
		denied = true;

		await copyFormatted(PAYLOAD);

		expect(console.warn).toHaveBeenCalled();
	});
});

describe('clearClipboardBuffer', () => {
	it('forgets a payload so the next copy cannot inherit it', async () => {
		await copyFormatted(PAYLOAD);
		clearClipboardBuffer();
		system = null;

		expect(await readFormatted()).toBeNull();
		expect(await readText()).toBeNull();
	});

	it('is idempotent', () => {
		expect(() => {
			clearClipboardBuffer();
			clearClipboardBuffer();
		}).not.toThrow();
	});
});