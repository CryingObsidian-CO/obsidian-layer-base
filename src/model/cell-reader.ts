import type { CellValue, Field, LayerDoc, LayerRecord } from '../types';
import { computeFormulaWithReader, type FormulaValue } from './formula';
import type { FormulaError } from './formula/lexer';
import { aggregateRollup, type RollupValue } from './rollup';
import { numberTexts } from './numbering';
import { emptyValueFor, formatCell, relationIds } from './fields';
import { findRecord } from './records';
import { readsFromView } from './capabilities';
import {
	lookupChips,
	relationBackIndex,
	relationBackRows,
	relationText,
	type BacklinkRow,
	type CellReader as CellTextReader,
} from './relation';

export interface CellReading {
	text: string;
	broken: number;
	chips?: readonly string[];
	kind?: 'number' | 'text' | 'boolean';
	ticked?: boolean;
	hint?: string;
}

/** The model may not import Obsidian: an editor supplies its live caches, the MCP server its own file reads. */
export interface CellReaderHost {
	/** The table a link points at; an empty `from` path means that same table. */
	table(field: Field, from: LayerDoc, direction: 'link' | 'back'): LayerDoc | null;
	noteProperty(notePath: string, key: string): string | null;
	notePropertyHint(): string;
	formulaError(error: FormulaError): { text: string; hint: string };
}

export class CellReader {
	private readDepth = 0;
	// Per-pass caches, per source column: built once, since per cell each would scan another table per row.
	private readonly backIndexes = new Map<string, Map<string, string[]> | null>();
	private readonly backRows = new Map<string, Map<string, BacklinkRow[]> | null>();
	private readonly numbers = new Map<string, Map<string, string>>();

	constructor(private readonly host: CellReaderHost) {}

	/** Drops answers tied to one render pass; call before drawing a new one. */
	reset(): void {
		this.readDepth = 0;
		this.backIndexes.clear();
		this.backRows.clear();
		this.numbers.clear();
	}

	/** Reads a cell the document cannot read itself; null leaves the type to the plain rules. */
	reading(doc: LayerDoc, field: Field, record: LayerRecord): CellReading | null {
		// Stops a computed column from reading another that reads it back.
		if (this.readDepth > 8) {
			return null;
		}
		this.readDepth += 1;
		try {
			return this.readingIn(doc, field, record);
		} finally {
			this.readDepth -= 1;
		}
	}

	private readingIn(doc: LayerDoc, field: Field, record: LayerRecord): CellReading | null {
		switch (field.type) {
			case 'noteProp':
				return this.notePropReading(doc, field, record.id);
			case 'autoNumber':
				return this.autoNumberReading(doc, field, record.id);
			case 'relation':
				return this.relationReading(doc, field, record.cells[field.id] ?? '');
			case 'relationBack':
				return this.backReading(doc, field, record.id);
			case 'formula':
				return this.formulaReading(doc, field, record.id);
			case 'rollup':
				return this.rollupReading(doc, field, record.id);
			case 'lookup':
				return this.lookupReading(doc, field, record.id);
			default:
				// Every stored type is read by the document itself.
				return null;
		}
	}

	text(doc: LayerDoc, field: Field, record: LayerRecord): string | null {
		return this.reading(doc, field, record)?.text ?? null;
	}

	displayText(doc: LayerDoc, field: Field, record: LayerRecord): string {
		const read = this.reading(doc, field, record);
		if (read !== null) {
			return read.text;
		}
		return formatCell(field, record.cells[field.id] ?? emptyValueFor(field));
	}

	/** The same answers, asked of the table those cells live in, so a relation can show a formula. */
	readerIn(doc: LayerDoc): CellTextReader {
		return (field, record) =>
			this.reading(doc, field, record)?.text ??
			formatCell(field, record.cells[field.id] ?? '');
	}

	notePropReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const text = this.notePropValueIn(doc, field, recordId);
		if (text === null) {
			return {
				text: '',
				broken: 0,
				hint: this.host.notePropertyHint(),
			};
		}
		return { text, broken: 0 };
	}

	private notePropValueIn(doc: LayerDoc, field: Field, recordId: string): string | null {
		const record = findRecord(doc, recordId);
		if (!record) {
			return '';
		}
		const source = doc.fields.find((candidate) => candidate.id === field.noteFieldId);
		if (!source || source.type !== 'note') {
			return '';
		}
		const path = record.cells[source.id];
		if (typeof path !== 'string' || path === '') {
			return '';
		}
		const key = field.frontmatterKey ?? field.name;
		return this.host.noteProperty(path, key);
	}

	/**
	 * Columns are re-read from the open document, not trusted from the cell that asked:
	 * the grid was built from an earlier render, and a formula reads the values as they are now.
	 */
	formulaReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return { text: '', broken: 0 };
		}
		// A column waiting to be set up, not a failure in every row.
		if ((target.formula ?? '').trim() === '') {
			return { text: '', broken: 0 };
		}
		const result = computeFormulaWithReader(doc, record, target, (other) =>
			this.formulaCellValueIn(doc, other, record, recordId),
		);
		if (result.ok) {
			// The text is what was computed; only the dressing follows the declared kind.
			return {
				text: result.text,
				broken: 0,
				kind: target.formulaType ?? result.kind,
				ticked: result.truthy,
			};
		}
		return { ...this.host.formulaError(result.error), broken: 1 };
	}

	/**
	 * Only for columns the document cannot read alone; anything else answers `undefined`
	 * and is read from its stored cell; a number must arrive as a number, or `+` joins text.
	 */
	formulaCellValueIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
		recordId: string,
	): FormulaValue | undefined {
		switch (field.type) {
			case 'relation':
				return this.relationReading(doc, field, record.cells[field.id] ?? '').text;
			case 'relationBack':
				return this.backReading(doc, field, recordId).text;
			case 'lookup':
				return this.lookupReading(doc, field, recordId).text;
			case 'autoNumber':
				return this.autoNumberReading(doc, field, recordId).text;
			case 'rollup': {
				const answer = this.rollupAnswerIn(doc, field, record, recordId);
				if (answer === null) {
					return '';
				}
				return answer.kind === 'number' ? Number(answer.text) : answer.text;
			}
			case 'noteProp':
				return this.notePropValueIn(doc, field, recordId) ?? '';
			default:
				return undefined;
		}
	}

	/**
	 * Position within its group, counted for the whole column once per pass: asking
	 * per cell would make the table cost its own square.
	 */
	autoNumberReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		let texts = this.numbers.get(field.id);
		if (!texts) {
			// The live column, not the copy the paint was handed: a setting may have changed.
			const target = doc.fields.find((other) => other.id === field.id) ?? field;
			texts = numberTexts(doc, target);
			this.numbers.set(field.id, texts);
		}
		return { text: texts.get(recordId) ?? '', broken: 0, kind: 'number' };
	}

	rollupReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const record = findRecord(doc, recordId);
		if (!record) {
			return { text: '', broken: 0 };
		}
		const answer = this.rollupAnswerIn(doc, field, record, recordId);
		if (answer === null) {
			return { text: '', broken: 0 };
		}
		return { text: answer.text, broken: 0, kind: answer.kind };
	}

	/** Null is both "not set up" and "the other table cannot be read": neither is an error. */
	private rollupAnswerIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
		recordId: string,
	): RollupValue | null {
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!target) {
			return null;
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.rollupSourceFieldId,
		);
		// Not configured, or pointing at a column that is gone: empty, not a failure in every row.
		if (!sourceField || !target.rollupFieldId) {
			return null;
		}
		const gathered = this.gatheredValuesIn(
			doc,
			sourceField,
			target.rollupFieldId,
			record,
			recordId,
		);
		if (gathered === null) {
			return null;
		}
		return aggregateRollup(
			gathered.map((entry) => entry.text ?? entry.value),
			target.rollupAggregate ?? 'sum',
		);
	}

	/** One chip per gathered value, in link order; a repeat stays, since dropping one forgets a linked row. */
	lookupReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return { text: '', broken: 0 };
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.lookupSourceFieldId,
		);
		const columnId = target.lookupFieldId ?? '';
		if (!sourceField || columnId === '') {
			return { text: '', broken: 0 };
		}
		const other = this.host.table(
			sourceField,
			doc,
			sourceField.type === 'relationBack' ? 'back' : 'link',
		);
		const gathered = this.gatheredValuesIn(
			doc,
			sourceField,
			columnId,
			record,
			recordId,
		);
		if (!other || gathered === null) {
			return { text: '', broken: 0 };
		}
		// Through the column's own formatter, not a link reader: a link reader expects
		// a cell of row ids and answers nothing for a plain value.
		const column = other.fields.find((candidate) => candidate.id === columnId);
		if (!column) {
			return { text: '', broken: 0 };
		}
		const chips = lookupChips(
			column,
			gathered.map((entry) => entry.value),
			(linked, value) => this.relationReading(other, linked, value).chips ?? [],
			gathered.map((entry) => entry.text),
		);
		return { text: chips.join(', '), broken: 0, chips };
	}

	/** Null is not an empty list: an empty list was read and had nothing, which a count answers as zero. */
	private gatheredValuesIn(
		doc: LayerDoc,
		sourceField: Field,
		columnId: string,
		record: LayerRecord,
		recordId: string,
	): readonly { value: CellValue; text: string | null }[] | null {
		if (sourceField.type === 'relation') {
			const other = this.host.table(sourceField, doc, 'link');
			if (!other) {
				return null;
			}
			return relationIds(record.cells[sourceField.id] ?? '').map((id) =>
				this.gatheredIn(other, columnId, findRecord(other, id)),
			);
		}

		if (sourceField.type === 'relationBack') {
			const other = this.host.table(sourceField, doc, 'back');
			if (!other) {
				return null;
			}
			const key = `${sourceField.id}\u0000${sourceField.backFieldId ?? ''}`;
			let rows = this.backRows.get(key);
			if (rows === undefined) {
				rows = relationBackRows(other, sourceField.backFieldId ?? '');
				this.backRows.set(key, rows);
			}
			if (rows === null) {
				return null;
			}
			return (rows.get(recordId) ?? []).map((row) =>
				this.gatheredIn(other, columnId, row.record),
			);
		}

		return null;
	}

	/**
	 * `text` is null for a column that stores what it shows, so the caller reads the stored
	 * value; a number must stay a number. Without it, a lookup over a formula gathers blanks.
	 */
	private gatheredIn(
		doc: LayerDoc,
		columnId: string,
		record: LayerRecord | undefined,
	): { value: CellValue; text: string | null } {
		if (!record) {
			return { value: '', text: null };
		}
		const stored = record.cells[columnId] ?? '';
		const column = doc.fields.find((candidate) => candidate.id === columnId);
		if (!column || !readsFromView(column.type)) {
			return { value: stored, text: null };
		}
		return {
			value: stored,
			text: this.reading(doc, column, record)?.text ?? '',
		};
	}

	relationReading(doc: LayerDoc, field: Field, value: CellValue): CellReading {
		const target = this.host.table(field, doc, 'link');
		if (!target) {
			return { text: '', broken: relationIds(value).length };
		}
		const resolved = relationText(
			target,
			field.linkFieldId ?? '',
			value,
			this.readerIn(target),
		);
		return {
			text: resolved.texts.join(', '),
			broken: resolved.broken,
			chips: resolved.texts,
		};
	}

	backReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const source = this.host.table(field, doc, 'back');
		if (source === null) {
			return { text: '', broken: 1 };
		}
		const titleFieldId = field.backTitleFieldId ?? '';
		const key = `${field.backPath ?? ''}\u0000${field.backFieldId ?? ''}\u0000${titleFieldId}`;
		let index = this.backIndexes.get(key);
		if (index === undefined) {
			index = relationBackIndex(
				source,
				field.backFieldId ?? '',
				titleFieldId,
				this.readerIn(source),
			);
			this.backIndexes.set(key, index);
		}
		if (index === null) {
			return { text: '', broken: 1 };
		}
		const texts = index.get(recordId) ?? [];
		return {
			text: texts.join(', '),
			broken: 0,
			chips: texts,
		};
	}
}
