import type {
	CellValue,
	Field,
	FieldType,
	FormulaError,
	LayerDoc,
	LayerRecord,
} from '../types';
import { formatCell, relationIds } from './fields';
import { computeFormula } from './formula';
import type { FormulaValue } from './formula';
import { numberTexts } from './numbering';
import { lookupChips, relationBackIndex, relationBackRows, relationText } from './relation';
import { aggregateRollup } from './rollup';

/**
 * What one cell reads as, to every reader there is.
 *
 * The grid, a board card, a copied range, a CSV export, the footer and a formula
 * all ask the same question — "what does this cell say?" — and they used to answer
 * it in five places, each with its own list of types. That is how a value came to
 * be blank in a formula while the grid showed it: one list had a type the other
 * did not. So the answer is given once, here, per type.
 *
 * `CellEnv` is what the document cannot know by itself: another table, a note's
 * frontmatter, and a place to memoise a scan for one render. The view supplies it;
 * everything else is this file's business.
 */
export interface CellEnv {
	/** The document holding the row. */
	doc: LayerDoc;
	/** Another table by its stored path ('' or unknown means this document). */
	table(path: string): LayerDoc | null;
	/** One frontmatter value of a note, or null when it cannot be read. */
	noteValue(notePath: string, key: string): string | null;
	/** Builds something once per render pass and hands it back after that. */
	cached<T>(key: string, build: () => T): T;
}

/** A cell's text, plus what is needed to draw and explain it. */
export interface CellReading {
	text: string;
	broken: number;
	/** Values to draw as separate chips, when the cell holds more than one. */
	chips?: readonly string[];
	/** What stands behind the text, when the caller knows. */
	kind?: 'number' | 'text' | 'boolean';
	/** Whether a box drawn for this cell is ticked. Only read when `kind` is boolean. */
	ticked?: boolean;
	/** A formula that could not run. The view turns this into words. */
	error?: FormulaError;
}

const PLAIN = (text: string): CellReading => ({ text, broken: 0 });

/** The value a row holds in a column, or the empty value of its shape. */
function valueOf(field: Field, record: LayerRecord): CellValue {
	return record.cells[field.id] ?? '';
}

/** Every stored type: the cell reads as its own formatter says. */
function storedReading(field: Field, record: LayerRecord): CellReading {
	return PLAIN(formatCell(field, valueOf(field, record)));
}

/**
 * What a cell reads as, one entry per type.
 *
 * Written as a table rather than a switch with a `default`, because the point of
 * this file is that no type can be forgotten: adding a member to `FieldType`
 * breaks the `Record` until it answers here.
 */
const READINGS: Record<
	FieldType,
	(field: Field, record: LayerRecord, env: CellEnv) => CellReading
> = {
	text: storedReading,
	longtext: storedReading,
	number: storedReading,
	date: storedReading,
	datetime: storedReading,
	select: storedReading,
	multiSelect: storedReading,
	checkbox: storedReading,
	note: storedReading,
	relation: relationReading,
	relationBack: backReading,
	lookup: lookupReading,
	rollup: rollupReading,
	formula: formulaReading,
	noteProp: notePropReading,
	autoNumber: autoNumberReading,
};

/** What a cell reads as. */
export function cellReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	return READINGS[field.type](field, record, env);
}

/**
 * What another column reads from this one, one entry per type.
 *
 * A relation hands over the names it shows rather than the ids it stores, and a
 * computed column hands over what it computed. `undefined` means "the document
 * reads this one itself", which is how a number stays a number instead of arriving
 * as text that `+` would then join.
 */
const READ_BY_OTHERS: Record<
	FieldType,
	(field: Field, record: LayerRecord, env: CellEnv) => FormulaValue | undefined
> = {
	text: () => undefined,
	longtext: () => undefined,
	number: () => undefined,
	date: () => undefined,
	datetime: () => undefined,
	select: () => undefined,
	multiSelect: () => undefined,
	checkbox: () => undefined,
	note: () => undefined,
	relation: textReading,
	relationBack: textReading,
	lookup: textReading,
	noteProp: textReading,
	autoNumber: textReading,
	rollup: (field, record, env) => {
		const reading = cellReading(field, record, env);
		return reading.kind === 'number' ? Number(reading.text) : reading.text;
	},
	formula: (field, record, env) => {
		const result = computeFormula(
			env.doc,
			record,
			field,
			0,
			new Set(),
			new Date(),
			(other) => cellFormulaValue(other, record, env),
		);
		return result.ok ? result.value : '';
	},
};

/** What another column reads from this one. */
export function cellFormulaValue(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): FormulaValue | undefined {
	return READ_BY_OTHERS[field.type](field, record, env);
}

/** A column whose reader wants the text the grid shows. */
function textReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): FormulaValue {
	return cellReading(field, record, env).text;
}

function relationReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	const value = valueOf(field, record);
	const target = env.table(field.linkPath ?? '');
	if (!target) {
		return { text: '', broken: relationIds(value).length };
	}
	const resolved = relationText(target, field.linkFieldId ?? '', value);
	return {
		text: resolved.texts.join(', '),
		broken: resolved.broken,
		chips: resolved.texts,
	};
}

function backReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	const source = env.table(field.backPath ?? '');
	if (!source) {
		return { text: '', broken: 1 };
	}
	const index = env.cached(
		`back\u0000${field.backPath ?? ''}\u0000${field.backFieldId ?? ''}\u0000${field.backTitleFieldId ?? ''}`,
		() =>
			relationBackIndex(
				source,
				field.backFieldId ?? '',
				field.backTitleFieldId ?? '',
			),
	);
	if (index === null) {
		return { text: '', broken: 1 };
	}
	const texts = index.get(record.id) ?? [];
	return { text: texts.join(', '), broken: 0, chips: texts };
}

/**
 * The values a lookup or a rollup gathers, or null when the other table is
 * unreachable — which is not the same as gathering nothing.
 */
function gatheredValues(
	sourceField: Field,
	columnId: string,
	record: LayerRecord,
	env: CellEnv,
): readonly CellValue[] | null {
	if (sourceField.type === 'relation') {
		const other = env.table(sourceField.linkPath ?? '');
		if (!other) {
			return null;
		}
		return relationIds(valueOf(sourceField, record)).map((id) => {
			const linked = other.records.find((candidate) => candidate.id === id);
			return linked ? (linked.cells[columnId] ?? '') : '';
		});
	}
	if (sourceField.type === 'relationBack') {
		const other = env.table(sourceField.backPath ?? '');
		if (!other) {
			return null;
		}
		const rows = env.cached(
			`rows\u0000${sourceField.backPath ?? ''}\u0000${sourceField.backFieldId ?? ''}`,
			() => relationBackRows(other, sourceField.backFieldId ?? ''),
		);
		if (rows === null) {
			return null;
		}
		return (rows.get(record.id) ?? []).map(
			(row) => row.record.cells[columnId] ?? '',
		);
	}
	return null;
}

/** The table a source column reads, so a gathered value can be formatted. */
function sourceTable(sourceField: Field, env: CellEnv): LayerDoc | null {
	return sourceField.type === 'relation'
		? env.table(sourceField.linkPath ?? '')
		: env.table(sourceField.backPath ?? '');
}

function lookupReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	const source = env.doc.fields.find(
		(candidate) => candidate.id === field.lookupSourceFieldId,
	);
	const columnId = field.lookupFieldId ?? '';
	// Not set up yet, or pointing at a column that is gone: a column waiting to be
	// configured reads as empty rather than as a failure in every row.
	if (!source || columnId === '') {
		return PLAIN('');
	}
	const other = sourceTable(source, env);
	const gathered = gatheredValues(source, columnId, record, env);
	if (!other || gathered === null) {
		return PLAIN('');
	}
	/* Read through the formatter of the column the values came from: a gathered
	 * value is the value itself, while a link reader expects a cell holding a list
	 * of row ids and answers nothing for anything else. */
	const column = other.fields.find((candidate) => candidate.id === columnId);
	if (!column) {
		return PLAIN('');
	}
	const chips = lookupChips(column, gathered, (linked, value) => {
		const target = env.table(linked.linkPath ?? '');
		return target ? relationText(target, linked.linkFieldId ?? '', value).texts : [];
	});
	return { text: chips.join(', '), broken: 0, chips };
}

function rollupReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	const source = env.doc.fields.find(
		(candidate) => candidate.id === field.rollupSourceFieldId,
	);
	const columnId = field.rollupFieldId ?? '';
	if (!source || columnId === '') {
		return PLAIN('');
	}
	const gathered = gatheredValues(source, columnId, record, env);
	if (gathered === null) {
		return PLAIN('');
	}
	const answer = aggregateRollup(gathered, field.rollupAggregate ?? 'sum');
	if (answer === null) {
		return PLAIN('');
	}
	return { text: answer.text, broken: 0, kind: answer.kind };
}

function formulaReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	// A column with no expression yet is waiting to be set up, not broken.
	if ((field.formula ?? '').trim() === '') {
		return PLAIN('');
	}
	const result = computeFormula(
		env.doc,
		record,
		field,
		0,
		new Set(),
		new Date(),
		(other) => cellFormulaValue(other, record, env),
	);
	if (!result.ok) {
		// The words for this live with the interface language, so the view says them.
		return { text: '', broken: 1, error: result.error };
	}
	return {
		text: result.text,
		broken: 0,
		kind: result.kind,
		ticked: result.truthy,
	};
}

/**
 * A note property's reading: the frontmatter value of the note the row names.
 *
 * A row with no note, a note that is not there, or a note without that key all
 * read as nothing, which is what an empty cell already means.
 */
function notePropReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	const source = env.doc.fields.find(
		(candidate) => candidate.id === field.noteFieldId,
	);
	if (!source || source.type !== 'note') {
		return PLAIN('');
	}
	const path = record.cells[source.id];
	if (typeof path !== 'string' || path === '') {
		return PLAIN('');
	}
	return PLAIN(env.noteValue(path, field.frontmatterKey ?? field.name) ?? '');
}

/** A numbering cell: its position in the table, padded, counted once per render. */
function autoNumberReading(
	field: Field,
	record: LayerRecord,
	env: CellEnv,
): CellReading {
	const texts = env.cached(`numbering\u0000${field.id}`, () =>
		numberTexts(env.doc, field),
	);
	return { text: texts.get(record.id) ?? '', broken: 0, kind: 'number' };
}
