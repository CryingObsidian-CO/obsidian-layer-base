import type { Field, SelectOption } from '../types';
import { generateId } from '../utils/id';

interface PaletteColor {
	readonly name: string;
	readonly hex: string;
}

/* Obsidian's accent names, so pills follow the theme; hex is for literal-colour inputs. */
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

/** Palette names become theme variables; hand-written `var()` and hex values pass through unchanged. */
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

/** A literal hex; anything unresolvable becomes grey so a bad value still paints a visible pill. */
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

export function nextOptionColor(
	options: readonly SelectOption[] | undefined,
): string {
	const used = options?.length ?? 0;
	return OPTION_PALETTE[used % OPTION_PALETTE.length] ?? 'blue';
}

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
 * `to` is the index in the finished list, so "put this one third" passes 2. Ids are untouched,
 * so unlike a rename or a removal this edit cannot orphan a cell.
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

export function normaliseOptionName(query: string): string {
	return query.trim();
}

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
 * Only a palette name or a literal `#rrggbb` may be stored; anything else would draw an
 * unstyled pill, so it is refused instead of stored.
 */
export function normaliseOptionColor(value: string): string | null {
	const trimmed = value.trim();
	if (isUnset(trimmed)) {
		return 'default';
	}
	return optionCssColor(trimmed) === null ? null : trimmed;
}

/** Renaming keeps the id: delete-and-add would orphan every cell that had chosen it. */
export function renameOption(field: Field, from: string, to: string): boolean {
	const option = findOptionByName(field, from);
	const name = normaliseOptionName(to);
	if (!option || name === '') {
		return false;
	}
	option.name = name;
	return true;
}

/** Cells that chose it keep the stale id and read as empty, as when an option is removed in the app. */
export function removeOption(field: Field, name: string): boolean {
	const option = findOptionByName(field, name);
	if (!option || !field.options) {
		return false;
	}
	field.options = field.options.filter((one) => one.id !== option.id);
	return true;
}

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
