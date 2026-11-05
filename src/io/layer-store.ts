import { TFile, TFolder, normalizePath, type App } from 'obsidian';
import { LAYER_EXTENSION } from '../constants';
import type { SeedLabels } from './schema';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from './schema';

export interface LoadedLayer {
	doc: ReturnType<typeof parseLayerDoc>['doc'];
	warnings: string[];
}

/** Upper bound on name attempts, so a pathological vault cannot spin forever. */
const MAX_NAME_ATTEMPTS = 50;

export class LayerStore {
	constructor(private readonly app: App) {}

	async createBoard(
		folder: TFolder | null,
		baseName: string,
		seed: SeedLabels,
	): Promise<TFile> {
		const base = baseName.trim() || seed.untitledBoard;

		for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
			const name = attempt === 1 ? base : `${base} ${attempt}`;
			const path = folder
				? normalizePath(`${folder.path}/${name}.${LAYER_EXTENSION}`)
				: normalizePath(`${name}.${LAYER_EXTENSION}`);

			/*
			 * A name already in use is the only reason to try another. Everything
			 * else `vault.create` can fail with — a character the vault refuses, a
			 * read-only vault, a full disk — is the answer rather than a collision,
			 * and trying it fifty times only buries it.
			 */
			if (this.app.vault.getAbstractFileByPath(path) !== null) {
				continue;
			}

			try {
				return await this.app.vault.create(
					path,
					serializeLayerDoc(createEmptyDoc(name, seed)),
				);
			} catch (error) {
				/*
				 * Somebody else took the name between the check and the write: a sync
				 * pull, or a second board asked for at the same moment. That is still
				 * a collision; anything else is the failure to report.
				 */
				if (this.app.vault.getAbstractFileByPath(path) !== null) {
					continue;
				}
				throw error;
			}
		}

		throw new Error(
			`Could not find an unused name after ${MAX_NAME_ATTEMPTS} attempts`,
		);
	}

	async load(file: TFile): Promise<LoadedLayer> {
		const text = await this.app.vault.cachedRead(file);
		return parseLayerDoc(text);
	}

	/**
	 * Writes an export beside the board it came from.
	 *
	 * Next to the file rather than into a fixed folder, because that is where the
	 * reader will look for it. A name already in use gets a suffix instead of being
	 * overwritten: an export is a copy, and a copy must not destroy a file.
	 */
	async writeExport(
		folder: TFolder,
		name: string,
		text: string,
	): Promise<TFile> {
		const dot = name.lastIndexOf('.');
		const base = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot + 1) : 'csv';
		const taken = new Set(
			folder.children
				.filter((child): child is TFile => child instanceof TFile)
				.map((child) => `${child.basename}.${child.extension}`),
		);

		for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
			const candidate =
				attempt === 1 ? `${base}.${extension}` : `${base} ${attempt}.${extension}`;
			if (taken.has(candidate)) {
				continue;
			}
			const path = folder.isRoot()
				? normalizePath(candidate)
				: normalizePath(`${folder.path}/${candidate}`);
			return await this.app.vault.create(path, text);
		}
		throw new Error(
			`Could not find an unused name after ${MAX_NAME_ATTEMPTS} attempts`,
		);
	}
}

/** True when the file is one this plugin can open. */
export function isLayerFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === LAYER_EXTENSION;
}
