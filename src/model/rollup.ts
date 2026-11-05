import type { CellValue, FieldType, RollupAggregate } from '../types';
import { capabilityOf } from './capabilities';
import { dayNumber } from './date';
import { parseShownNumber } from './number';

/**
 * What a rollup computed, and what kind of value stands behind it.
 *
 * `kind` travels with the text for the same reason a formula's does: a total has
 * to line up on the right, and a date has to be shown as a date.
 */
export interface RollupValue {
	text: string;
	kind: 'number' | 'text';
}

/** A value a rollup gathered from one related row. */
type Gathered = CellValue;

/** Whether a cell holds anything to reduce: blank text and empty lists do not. */
function isFilled(value: Gathered): boolean {
	if (value === undefined || value === null) {
		return false;
	}
	if (typeof value === 'string') {
		return value.trim() !== '';
	}
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	return true;
}

/** The number a cell stands for, or null when it does not stand for one. */
function asNumber(value: Gathered): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'boolean') {
		return value ? 1 : 0;
	}
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	if (trimmed === '') {
		return null;
	}
	// The same reading the cells use, so a collected "50%" is half, not fifty.
	return parseShownNumber(trimmed);
}

/** The text a cell reads as, which is what a text aggregate gathers. */
function asText(value: Gathered): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	if (Array.isArray(value)) {
		return value.join(', ');
	}
	return '';
}

/** Whether a gathered value reads as a calendar date, for the date comparisons. */
function asDay(value: Gathered): number | null {
	const text = asText(value).trim();
	return text === '' ? null : dayNumber(text);
}

/**
 * Reduces the values gathered from the related rows.
 *
 * Two rules are worth stating because they decide what an empty column shows:
 * a row that holds nothing does not contribute to any aggregate, and a rollup
 * over no rows at all answers `null` — except the two counts, which have a true
 * answer of zero. That is the difference between "no children" and "the total is
 * nothing", which a reader needs to be able to tell apart.
 */
export function aggregateRollup(
	values: readonly Gathered[],
	how: RollupAggregate,
): RollupValue | null {
	if (how === 'countAll') {
		return { text: String(values.length), kind: 'number' };
	}

	const filled = values.filter(isFilled);
	if (how === 'count') {
		return { text: String(filled.length), kind: 'number' };
	}
	if (filled.length === 0) {
		return null;
	}

	if (how === 'sum' || how === 'average') {
		let total = 0;
		let used = 0;
		for (const value of filled) {
			const number = asNumber(value);
			if (number !== null) {
				total += number;
				used += 1;
			}
		}
		// Nothing in the column could be read as a number, so there is no total to
		// report rather than a total of zero.
		if (used === 0) {
			return null;
		}
		const answer = how === 'sum' ? total : total / used;
		return { text: formatNumber(answer), kind: 'number' };
	}

	// The rest are min and max, which compare numbers and dates. A column of dates
	// answers with the date itself, so the reader sees the day rather than a count.
	const dayNumbers = filled
		.map(asDay)
		.filter((day): day is number => day !== null);
	if (dayNumbers.length === filled.length) {
		const chosen = pickDay(filled, dayNumbers, how);
		return chosen === null ? null : { text: asText(chosen), kind: 'text' };
	}

	const numbers = filled
		.map(asNumber)
		.filter((number): number is number => number !== null);
	if (numbers.length === filled.length) {
		const picked = pickNumber(numbers, how);
		return picked === null ? null : { text: formatNumber(picked), kind: 'number' };
	}

	// Mixed or unreadable: fall back to comparing the text, which at least answers
	// the same way twice instead of refusing the whole column.
	const texts = filled.map(asText);
	const chosen = texts.reduce((best, next) =>
		how === 'min' ? (next < best ? next : best) : next > best ? next : best,
	);
	return { text: chosen, kind: 'text' };
}

function pickNumber(numbers: readonly number[], how: RollupAggregate): number | null {
	if (numbers.length === 0) {
		return null;
	}
	return numbers.reduce((best, next) =>
		how === 'min' ? Math.min(best, next) : Math.max(best, next),
	);
}

function pickDay(
	values: readonly Gathered[],
	days: readonly number[],
	how: RollupAggregate,
): Gathered | null {
	if (values.length === 0) {
		return null;
	}
	let bestIndex = 0;
	for (let index = 1; index < days.length; index += 1) {
		const day = days[index] as number;
		const best = days[bestIndex] as number;
		if (how === 'min' ? day < best : day > best) {
			bestIndex = index;
		}
	}
	return values[bestIndex] ?? null;
}

/** A computed number without floating-point noise trailing behind it. */
function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

/**
 * The aggregates a column of this type can answer.
 *
 * Narrowed by type on purpose: offering "sum" for a column of text would let a
 * rollup be configured that can never produce anything, and the mistake would only
 * show as an empty column afterwards. Dates get the comparisons but not the sums,
 * because adding two dates is not a quantity.
 */
export function aggregatesFor(type: FieldType): readonly RollupAggregate[] {
	return capabilityOf(type).aggregates;
}