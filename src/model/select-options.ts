import type { Field, SelectOption } from '../types';
import { generateId } from '../utils/id';

/** A colour an option can wear: the name stored in the file, and its hex. */
interface PaletteColor {
	readonly name: string;
	readonly hex: string;
}

/*
 * The single table behind every colour decision in this module: the name written
 * into `SelectOption.color`, the theme variable that name resolves to, and the
 * canonical hex for places that need a literal value (a native colour input,
 * for instance). Keeping the three side by side is what stops the name -> var
 * and name -> hex mappings from drifting apart.
 *
 * The names are Obsidian's own accent names, so pills follow the active theme
 * rather than pinning hues of their own.
 */
const OPTION_COLORS: readonly PaletteColor[] = [
	{ name: 'blue', hex: '#086ddd' },
	{ name: 'green', hex: '#08b94e' },
	{ name: 'orange', hex: '#ec7500' },
	{ name: 'purple', hex: '#7852ee' },
	{ name: 'red', hex: '#e93147' },
	{ name: 'cyan', hex: '#00bfbc' },
	{ name: 'yellow', hex: '#e0ac00' },
	{ name: 'pink', hex: '#d53984' },
];

/** The names a new option cycles through, in the order they are handed out. */
export const OPTION_PALETTE: readonly string[] = OPTION_COLORS.map(
	(color) => color.name,
);

/** Used when a stored colour cannot be resolved: visible, but clearly neutral. */
const FALLBACK_HEX = '#888888';

const SHORT_HEX = /^#[0-9a-f]{3}$/i;
const LONG_HEX = /^#[0-9a-f]{6}$/i;
const THEME_VAR = /^var\(\s*--color-([a-z0-9-]+)\s*\)$/i;

/** `'default'` and blanks mean "no colour of its own", so both count as unset. */
function isUnset(value: string): boolean {
	return value === '' || value.toLowerCase() === 'default';
}

/** The palette entry for a name, ignoring case. */
function paletteColor(value: string): PaletteColor | undefined {
	const name = value.toLowerCase();
	return OPTION_COLORS.find((entry) => entry.name === name);
}

/** The palette entry behind `var(--color-name)`, when that name is one of ours. */
function themeColor(value: string): PaletteColor | undefined {
	const match: RegExpExecArray | null = THEME_VAR.exec(value.trim());
	const name = match?.[1];
	return name ? paletteColor(name) : undefined;
}

/**
 * The CSS colour for an option, or `null` when it has none we can resolve.
 * Palette names become theme variables; `var(...)` references and hex literals
 * are handed back as written, so a value set by hand keeps working.
 */
export function optionCssColor(color: string | undefined): string | null {
	const value = color?.trim() ?? '';
	if (isUnset(value)) {
		return null;
	}
	const palette = paletteColor(value);
	if (palette) {
		return `var(--color-${palette.name})`;
	}
	if (THEME_VAR.test(value) || SHORT_HEX.test(value) || LONG_HEX.test(value)) {
		return value;
	}
	return null;
}

/**
 * The canonical hex for an option, for places that need a literal colour rather
 * than a variable. Anything unresolvable becomes grey, so a bad value still
 * leaves a visible pill instead of throwing or painting nothing.
 */
export function optionColorHex(color: string | undefined): string {
	const value = color?.trim() ?? '';
	const palette = paletteColor(value) ?? themeColor(value);
	if (palette) {
		return palette.hex;
	}
	if (SHORT_HEX.test(value)) {
		const expanded = value
			.slice(1)
			.toLowerCase()
			.split('')
			.map((digit) => digit + digit)
			.join('');
		return `#${expanded}`;
	}
	if (LONG_HEX.test(value)) {
		return value.toLowerCase();
	}
	return FALLBACK_HEX;
}

/** The colour to give the next option: the palette, stepped by how many exist. */
export function nextOptionColor(
	options: readonly SelectOption[] | undefined,
): string {
	const used = options?.length ?? 0;
	return OPTION_PALETTE[used % OPTION_PALETTE.length] ?? 'blue';
}

/** Where each option sits in the field's order, by id, first mention winning. */
export function optionRanks(
	options: readonly SelectOption[] | undefined,
): Map<string, number> {
	const ranks = new Map<string, number>();
	options?.forEach((option, index) => {
		if (!ranks.has(option.id)) {
			ranks.set(option.id, index);
		}
	});
	return ranks;
}

/**
 * The list with one option moved, or null when nothing would move.
 *
 * `to` is the index the option ends up at, counted in the finished list, so a
 * caller that has worked out "put this one third" passes 2. Ids are untouched:
 * this is the one option edit that cannot orphan a cell, unlike a rename or a
 * removal, because a cell stores an id and not a position.
 */
export function reorderOption(
	options: readonly SelectOption[],
	id: string,
	to: number,
): SelectOption[] | null {
	const from = options.findIndex((option) => option.id === id);
	if (from < 0 || !Number.isFinite(to)) {
		return null;
	}
	const target = Math.max(0, Math.min(Math.round(to), options.length - 1));
	if (target === from) {
		return null;
	}
	const next = [...options];
	const moved = next.splice(from, 1)[0];
	if (!moved) {
		return null;
	}
	next.splice(target, 0, moved);
	return next;
}

/** A field's option by name, ignoring case and surrounding spaces. */
export function findOptionByName(
	field: Field,
	name: string,
): SelectOption | undefined {
	const wanted = name.trim().toLowerCase();
	if (!wanted) {
		return undefined;
	}
	return field.options?.find(
		(option) => option.name.trim().toLowerCase() === wanted,
	);
}

/** The options matching a search query, in the order they were stored. Blank keeps them all. */
export function filterOptions(
	options: readonly SelectOption[] | undefined,
	query: string,
): SelectOption[] {
	const all = options ? [...options] : [];
	const needle = query.trim().toLowerCase();
	return needle
		? all.filter((option) => option.name.toLowerCase().includes(needle))
		: all;
}

/** The name a typed query would create: trimmed, or `''` when there is none. */
export function normaliseOptionName(query: string): string {
	return query.trim();
}

/** Appends a new option, creating the list and choosing the next colour. */
export function appendOption(field: Field, name: string): SelectOption {
	field.options ??= [];
	const option: SelectOption = {
		id: generateId('o'),
		name,
		color: nextOptionColor(field.options),
	};
	field.options.push(option);
	return option;
}

/**
 * The colour to store for an option, or null when it is not one we can draw.
 *
 * Two spellings are legitimate: a palette name, which a new option is given, and a
 * literal `#rrggbb`, which is what the colour picker writes. Anything neither the
 * palette nor the theme variable resolves would leave an unstyled pill, so it is
 * refused instead of stored.
 */
export function normaliseOptionColor(value: string): string | null {
	const trimmed = value.trim();
	if (isUnset(trimmed)) {
		return 'default';
	}
	return optionCssColor(trimmed) === null ? null : trimmed;
}

/**
 * Renames an option, keeping its id.
 *
 * The id is what a cell stores, so renaming through a delete-and-add would orphan
 * every row that had chosen it. Says whether the option was there.
 */
export function renameOption(field: Field, from: string, to: string): boolean {
	const option = findOptionByName(field, from);
	const name = normaliseOptionName(to);
	if (!option || name === '') {
		return false;
	}
	option.name = name;
	return true;
}

/**
 * Removes an option by name.
 *
 * Cells that had chosen it keep the stale id, exactly as they do when an option is
 * removed in the app: they read as empty, and nothing here rewrites a row nobody
 * asked about. Says whether the option was there.
 */
export function removeOption(field: Field, name: string): boolean {
	const option = findOptionByName(field, name);
	if (!option || !field.options) {
		return false;
	}
	field.options = field.options.filter((one) => one.id !== option.id);
	return true;
}

/** Gives an option a colour. False when either the option or the colour is unusable. */
export function setOptionColor(
	field: Field,
	name: string,
	color: string,
): boolean {
	const option = findOptionByName(field, name);
	const stored = normaliseOptionColor(color);
	if (!option || stored === null) {
		return false;
	}
	option.color = stored;
	return true;
}
