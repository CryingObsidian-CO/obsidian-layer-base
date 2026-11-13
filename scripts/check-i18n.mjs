#!/usr/bin/env node
/* These checks need the locale files, and reading them from `tests/` would need `node:fs`,
 * which the Obsidian lint rule forbids in a plugin that must run on mobile. So they live
 * here, where Node is the runtime by definition. */
import { readFileSync } from 'node:fs';

// A path may be passed in, to point this at a broken copy.
const SOURCE = process.argv[2] ?? 'src/i18n/index.ts';
const text = readFileSync(SOURCE, 'utf8');

/** Every `key: '...'` entry, in the order it appears. */
const entries = [...text.matchAll(/^\t(\w+):\s*'((?:[^'\\]|\\.)*)',?$/gm)].map(
	(match) => ({ key: match[1], value: match[2], index: match.index }),
);

const problems = [];

/** A tooltip is a label: it does not end in a full stop, half- or full-width. */
const TOOLTIP = /^formulaFn/;
for (const { key, value } of entries) {
	if (!TOOLTIP.test(key)) {
		continue;
	}
	if (/[.。]$/.test(value)) {
		problems.push(`${key} is a tooltip and must not end with a full stop: "${value}"`);
	}
	if (value.trim() === '') {
		problems.push(`${key} is empty`);
	}
}

/* Each catalogue is its own object literal, so the block a key lands in is the locale that
 * defines it; counting across the file would let one locale's duplicate stand in for
 * another's silence. */
const blocks = [...text.matchAll(/^const (\w+) = \{/gm)].map((match, i, all) => ({
	name: match[1],
	start: match.index,
	end: i + 1 < all.length ? all[i + 1].index : text.length,
}));
if (blocks.length === 0) {
	problems.push(`no locale catalogues found in ${SOURCE}`);
}

/* The `Locale` union is the other half of the same fact: counting catalogues alone would
 * let a whole one vanish quietly. */
const declaredLocales = (
	/^export type Locale = ([^;]+);/m.exec(text)?.[1].match(/'[^']*'/g) ?? []
).length;
if (declaredLocales !== blocks.length) {
	problems.push(
		`the Locale type lists ${declaredLocales} language(s), but ${SOURCE} has ${blocks.length} catalogue(s)`,
	);
}

const definitions = new Map();
for (const { key, index } of entries) {
	const block = blocks.find((b) => index >= b.start && index < b.end);
	if (!block) {
		continue;
	}
	const per = definitions.get(key) ?? new Map();
	per.set(block.name, (per.get(block.name) ?? 0) + 1);
	definitions.set(key, per);
}

/** e.g. `en 1, zh 1, zhTW 0`. */
const describe = (per) => blocks.map((b) => `${b.name} ${per?.get(b.name) ?? 0}`).join(', ');

function missingWording(what, key) {
	const per = definitions.get(key);
	if (blocks.every((b) => (per?.get(b.name) ?? 0) === 1)) {
		return;
	}
	problems.push(`${what}: ${key} is defined ${describe(per)}`);
}

for (const [key, per] of definitions) {
	if (blocks.some((b) => (per.get(b.name) ?? 0) !== 1)) {
		problems.push(`${key} is defined ${describe(per)}; every locale needs it once`);
	}
}

/* Read from `eval.ts` so a function added to the engine cannot be forgotten: it will
 * simply have no tooltip, and fail. */
const ENGINE = 'src/model/formula/eval.ts';
const engineText = readFileSync(ENGINE, 'utf8');
const builtinBlock = engineText.slice(
	engineText.indexOf('const BUILTINS'),
	engineText.indexOf('/** The names a formula may call'),
);
const functions = [...builtinBlock.matchAll(/^\t([A-Z][A-Z0-9_]*):\s*\{/gm)].map(
	(match) => match[1],
);

if (functions.length === 0) {
	problems.push(`no built-in functions found in ${ENGINE}`);
}

function tooltipKeyFor(name) {
	return `formulaFn${name.charAt(0)}${name.slice(1).toLowerCase()}`;
}

for (const name of functions) {
	missingWording(`${name} has no tooltip`, tooltipKeyFor(name));
}

/** Each function group needs a label with wording. */
const groupKeys = [
	...engineText.matchAll(/labelKey:\s*'(\w+)'/g),
].map((match) => match[1]);
if (groupKeys.length === 0) {
	problems.push('no function groups found in the engine');
}
for (const key of groupKeys) {
	missingWording('a group label needs wording', key);
}

/** A group naming a renamed or removed function fails here. */
const grouped = [...engineText.matchAll(/functions:\s*\[([^\]]*)\]/g)]
	.flatMap((match) => match[1].split(','))
	.map((name) => name.replace(/['"\s]/g, ''))
	.filter((name) => name !== '');
for (const name of grouped) {
	if (!functions.includes(name)) {
		problems.push(`a group names "${name}", which is not a built-in function`);
	}
}

/** Every symbol needs a sentence, or its button explains nothing. */
const symbolKeys = [...engineText.matchAll(/hintKey:\s*'(\w+)'/g)].map(
	(match) => match[1],
);
if (symbolKeys.length === 0) {
	problems.push('no formula symbols found in the engine');
}
for (const key of symbolKeys) {
	missingWording('a symbol needs wording', key);
}

if (problems.length > 0) {
	console.error(`Locale checks failed (${problems.length}):`);
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
}

console.log(
	`Locale checks passed: ${definitions.size} keys, ${entries.length} entries, ${blocks.length} locales.`,
);
