import type { CellValue, FieldType, RollupAggregate } from '../types';
import { capabilityOf } from './capabilities';
import { dateMinutes } from './date';
import { parseShownNumber } from './number';

/** `kind` travels with the text so a total lines up on the right and a date shows as a date. */
export interface RollupValue {
	text: string;
	kind: 'number' | 'text';
}

type Gathered = CellValue;

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

/**
 * Minutes, not days: otherwise two date-times on one day tie and "latest" keeps 09:00. A value
 * naming only a day sits at the start of it.
 */
function asMoment(value: Gathered): number | null {
	const text = asText(value).trim();
	return text === '' ? null : dateMinutes(text);
}

/**
 * A row that holds nothing contributes to no aggregate, and a rollup over no rows answers null
 * except the two counts, whose true answer is zero: "no children" is not "the total is nothing".
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
		// Nothing could be read as a number: no total to report, rather than a total of zero.
		if (used === 0) {
			return null;
		}
		const answer = how === 'sum' ? total : total / used;
		return { text: formatNumber(answer), kind: 'number' };
	}

	// min/max compare numbers or dates; a date column answers with the date itself, time included.
	const moments = filled
		.map(asMoment)
		.filter((moment): moment is number => moment !== null);
	if (moments.length === filled.length) {
		const chosen = pickMoment(filled, moments, how);
		return chosen === null ? null : { text: asText(chosen), kind: 'text' };
	}

	const numbers = filled
		.map(asNumber)
		.filter((number): number is number => number !== null);
	if (numbers.length === filled.length) {
		const picked = pickNumber(numbers, how);
		return picked === null ? null : { text: formatNumber(picked), kind: 'number' };
	}

	// Mixed or unreadable: compare as text, which at least answers the same way twice.
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

function pickMoment(
	values: readonly Gathered[],
	moments: readonly number[],
	how: RollupAggregate,
): Gathered | null {
	if (values.length === 0) {
		return null;
	}
	let bestIndex = 0;
	for (let index = 1; index < moments.length; index += 1) {
		const moment = moments[index] as number;
		const best = moments[bestIndex] as number;
		if (how === 'min' ? moment < best : moment > best) {
			bestIndex = index;
		}
	}
	return values[bestIndex] ?? null;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

export function aggregatesFor(type: FieldType): readonly RollupAggregate[] {
	return capabilityOf(type).aggregates;
}