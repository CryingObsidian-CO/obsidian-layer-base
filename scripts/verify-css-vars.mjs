// Checks that every Obsidian CSS variable used in styles.css actually exists
// in the installed Obsidian build, by reading app.css out of obsidian.asar.
//
// Usage: node scripts/verify-css-vars.mjs [path-to-obsidian.asar]

import { existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/*
 * The header of an asar archive is a directory listing, a few hundred kilobytes in
 * practice. This bound exists so four arbitrary bytes in a file that is not an
 * archive cannot ask for a multi-gigabyte zero-filled allocation.
 */
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

/** Reads a file out of an .asar archive without needing the asar package. */
function readFromAsar(asarPath, wanted) {
	const fd = openSync(asarPath, 'r');
	try {
		/*
		 * Every value below comes from the file, so none of them is trusted: a read
		 * can come up short, the header length is four arbitrary bytes, and the
		 * header may not be JSON at all. Each is checked before it is used, so a file
		 * that is not an archive says so — rather than surfacing later as a JSON
		 * error about a file that never held any JSON.
		 */
		const prefix = Buffer.alloc(16);
		if (readSync(fd, prefix, 0, 16, 0) !== 16) {
			throw new Error('too small to be an asar archive (no 16-byte prefix)');
		}
		const headerSize = prefix.readUInt32LE(12);
		if (
			!Number.isInteger(headerSize) ||
			headerSize <= 0 ||
			headerSize > MAX_HEADER_BYTES
		) {
			throw new Error(`not an asar archive (header length ${headerSize})`);
		}
		const headerBuf = Buffer.alloc(headerSize);
		if (readSync(fd, headerBuf, 0, headerSize, 16) !== headerSize) {
			throw new Error(`truncated asar header (${headerSize} bytes expected)`);
		}
		let header;
		try {
			header = JSON.parse(headerBuf.toString('utf8'));
		} catch (cause) {
			throw new Error('asar header is not JSON', { cause });
		}
		const base = 16 + headerSize;

		const walk = (node, trail = '') => {
			for (const [name, entry] of Object.entries(node.files ?? {})) {
				const path = trail ? `${trail}/${name}` : name;
				if (entry.files) {
					const hit = walk(entry, path);
					if (hit) return hit;
				} else if (path === wanted) {
					return entry;
				}
			}
			return null;
		};

		const entry = walk(header);
		if (!entry) return null;

		const data = readFileSync(asarPath);
		const start = base + Number(entry.offset);
		return data.subarray(start, start + entry.size).toString('utf8');
	} finally {
		closeSync(fd);
	}
}

function findObsidianAsar() {
	if (process.argv[2]) {
		return process.argv[2];
	}
	// Common install locations; the first that exists wins.
	const candidates = [
		'C:/Program Files/Obsidian/resources/obsidian.asar',
		'C:/Users/' + (process.env.USERNAME ?? '') + '/AppData/Local/Programs/Obsidian/resources/obsidian.asar',
		'D:/common/Obsidian/resources/obsidian.asar',
	];
	return candidates.find((p) => existsSync(p)) ?? null;
}

// Variables actually referenced by the plugin's stylesheet.
const STYLESHEET = 'styles.css';
let sheet;
try {
	sheet = readFileSync(STYLESHEET, 'utf8');
} catch {
	console.error(`Cannot read ${STYLESHEET}; run this from the plugin root.`);
	process.exit(1);
}
const referenced = [
	...new Set([...sheet.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])),
].sort();

/**
 * Variables the plugin declares itself.
 */
const declaredLocally = new Set(
	[...sheet.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);
const used = referenced.filter((v) => !declaredLocally.has(v));
const local = referenced.filter((v) => declaredLocally.has(v));

const asarPath = findObsidianAsar();
if (!asarPath) {
	console.error('Could not locate obsidian.asar.');
	console.error('Pass its path explicitly: node scripts/verify-css-vars.mjs <path-to-obsidian.asar>');
	process.exit(1);
}
if (!existsSync(asarPath)) {
	console.error(`No such file: ${asarPath}`);
	process.exit(1);
}

let css;
try {
	css = readFromAsar(asarPath, 'app.css');
} catch (error) {
	console.error(`Could not read ${asarPath}: ${error.message}`);
	process.exit(1);
}
if (!css) {
	console.error(`app.css not found inside ${asarPath}.`);
	process.exit(1);
}

console.log(`Checked against ${asarPath} (${basename(asarPath)}, app.css ${css.length} bytes)\n`);

let bad = 0;
for (const v of used) {
	/*
	 * A declaration starts a line, follows a `{`, or follows a `;`. The app ships
	 * this stylesheet pretty-printed in some builds and folded onto a single line
	 * in others, and anchoring on the line start alone reported every variable as
	 * missing the first time that changed.
	 */
	const pattern = '(?:^|[;{])\\s*' + v.replace(/-/g, '\\-') + '\\s*:';
	const hits = [...css.matchAll(new RegExp(pattern, 'g'))].length;
	if (hits === 0) {
		bad++;
		console.log(`MISSING  ${v}`);
	} else {
		console.log(`ok       ${v}  (declared ${hits}x)`);
	}
}

for (const v of local) {
	console.log(`local    ${v}  (declared in this stylesheet)`);
}

console.log(
	bad === 0
		? `\nAll ${used.length} Obsidian variables exist in this build` +
				(local.length > 0 ? `, and ${local.length} local variable(s) resolve.` : '.')
		: `\n${bad} variable(s) do not exist.`,
);
process.exit(bad === 0 ? 0 : 1);