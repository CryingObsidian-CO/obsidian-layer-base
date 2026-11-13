// Checks that every Obsidian CSS variable used in styles.css exists in the installed
// build, by reading app.css out of obsidian.asar. Usage: node scripts/verify-css-vars.mjs
// [path-to-obsidian.asar]. With no Obsidian install, the comparison is skipped with a message.

import { existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/* The header is a directory listing of a few hundred KB; this bound stops four arbitrary
 * bytes asking for a multi-gigabyte zero-filled allocation. */
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

/** Reads a file out of an .asar archive without needing the asar package. */
function readFromAsar(asarPath, wanted) {
	const fd = openSync(asarPath, 'r');
	try {
/* Every value below comes from the file and is untrusted: short reads, a length of four
 * arbitrary bytes, a header that may not be JSON. Checking each makes a non-archive fail
 * as one rather than later as a confusing JSON error. */
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
/* The JSON header is padded to a 4-byte boundary and offsets count from there. Skipping the
 * padding does not fail loudly: every file shifts a few bytes and still almost reads. */
		const headerEnd = 16 + headerSize;
		const base = headerEnd + ((4 - (headerEnd % 4)) % 4);

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

const STYLESHEET = 'styles.css';
let sheet;
try {
	sheet = readFileSync(STYLESHEET, 'utf8');
} catch {
	console.error(`Cannot read ${STYLESHEET}; run this from the plugin root.`);
	process.exit(1);
}
/* Comments are stripped first: a `var()` in a comment is prose, and a declaration in one
 * declares nothing. */
const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '');

/* `[\w-]`, not `[a-z0-9-]`: a custom property is case-sensitive and may hold uppercase and
 * underscores; a narrower class cut `var(--obsidian_local)` down to `--obsidian`. */
const referenced = [
	...new Set([...code.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])),
].sort();

const declaredLocally = new Set(
	[...code.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]),
);
const used = referenced.filter((v) => !declaredLocally.has(v));
const local = referenced.filter((v) => declaredLocally.has(v));

const asarPath = findObsidianAsar();
if (!asarPath) {
/* A CI runner has no Obsidian, so the comparison is skipped loudly rather than reported as a
 * pass; a path that was named and is missing is still a failure below. */
	console.log(
		'SKIPPED: no Obsidian install found, so the used variables were not',
	);
	console.log(
		'checked against a build. Pass one: node scripts/verify-css-vars.mjs <path-to-obsidian.asar>',
	);
	process.exit(0);
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
/* A declaration is inside a block, so `{` or `;` precedes it; `^` with `m` catches one that
 * begins a line. `v` is matched from `--[\w-]+`, so it holds no character the pattern reads
 * as syntax. */
	const pattern = '(?:^|[;{])\\s*' + v + '\\s*:';
	const hits = [...css.matchAll(new RegExp(pattern, 'gm'))].length;
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