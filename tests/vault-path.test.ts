import { afterEach, describe, expect, it } from 'vitest';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	rmdirSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';
import { staysInside, vaultGuard } from '../mcp/vault-path';

/** A junction needs no administrator rights on Windows; elsewhere, a plain symlink. */
const LINK = platform === 'win32' ? 'junction' : 'dir';

const made: { base: string; links: string[] }[] = [];

/** A vault, a place outside it, and a link between them. */
function makeVault(): { vault: string; outside: string; link: string } {
	const base = mkdtempSync(join(tmpdir(), 'layer-vault-test-'));
	const vault = join(base, 'Vault');
	const outside = join(base, 'Outside');
	mkdirSync(vault);
	mkdirSync(outside);
	writeFileSync(join(outside, 'secret.layer'), '{"version":1}');

	const link = join(vault, 'link');
	// A junction on Windows: it needs no administrator rights, and it is what a
	// user makes when they want one folder to live in two places.
	symlinkSync(outside, link, LINK);

	made.push({ base, links: [link] });
	return { vault, outside, link };
}

afterEach(() => {
	for (const { base, links } of made.splice(0)) {
		/*
		 * The link goes first. Removing the tree it sits in would otherwise walk
		 * through it and delete what is on the other side.
		 */
		for (const link of links) {
			try {
				rmdirSync(link);
			} catch {
				try {
					unlinkSync(link);
				} catch {
					// Already gone.
				}
			}
		}
		rmSync(base, { recursive: true, force: true });
	}
});

describe('what a path says', () => {
	it('accepts a name that merely begins with two dots', () => {
		expect(staysInside(join('..notes', 'table.layer'))).toBe(true);
		expect(staysInside('..draft.layer')).toBe(true);
	});

	it('refuses the parent itself and anything above it', () => {
		expect(staysInside('..')).toBe(false);
		expect(staysInside(join('..', 'elsewhere.layer'))).toBe(false);
	});
});

describe('a path in the vault', () => {
	it('resolves a plain name', () => {
		const { vault } = makeVault();
		expect(vaultGuard(vault)('board.layer')).toBe(join(vault, 'board.layer'));
	});

	it('resolves a name that starts with two dots', () => {
		const { vault } = makeVault();
		writeFileSync(join(vault, '..draft.layer'), '{"version":1}');

		expect(vaultGuard(vault)('..draft.layer')).toBe(join(vault, '..draft.layer'));
	});

	it('refuses a path that climbs out', () => {
		const { vault } = makeVault();
		const guard = vaultGuard(vault);

		expect(() => guard(join('..', 'Outside', 'secret.layer'))).toThrow('Outside the vault');
		expect(() => guard(join('..', '..', 'secret.layer'))).toThrow('Outside the vault');
	});

	it('refuses a path that leaves through a link inside the vault', () => {
		const { vault } = makeVault();
		const guard = vaultGuard(vault);

		expect(() => guard(join('link', 'secret.layer'))).toThrow('through a link');
	});

	it('refuses a file that does not exist yet but would be written through a link', () => {
		const { vault } = makeVault();
		const guard = vaultGuard(vault);

		expect(() => guard(join('link', 'later.layer'))).toThrow('through a link');
	});

	it('still allows a link that points inside the vault', () => {
		const { vault } = makeVault();
		const inside = join(vault, 'boards');
		mkdirSync(inside);
		writeFileSync(join(inside, 'real.layer'), '{"version":1}');
		const link = join(vault, 'shortcut');
		symlinkSync(inside, link, LINK);
		made.at(-1)?.links.push(link);

		expect(vaultGuard(vault)(join('shortcut', 'real.layer'))).toBe(
			join(vault, 'shortcut', 'real.layer'),
		);
	});

	it('asks for a path when given none', () => {
		const { vault } = makeVault();

		expect(() => vaultGuard(vault)('')).toThrow('A table path is required');
		expect(() => vaultGuard(vault)(undefined)).toThrow('A table path is required');
	});
});
