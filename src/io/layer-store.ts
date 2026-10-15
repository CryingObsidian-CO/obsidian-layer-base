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
		const taken = this.takenNamesIn(folder);
		let name = base;

		for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
			if (attempt > 1) {
				name = `${base} ${attempt}`;
			}

			const path = folder
				? normalizePath(`${folder.path}/${name}.${LAYER_EXTENSION}`)
				: normalizePath(`${name}.${LAYER_EXTENSION}`);

			try {
				await this.app.vault.create(
					path,
					serializeLayerDoc(createEmptyDoc(name, seed)),
				);
			} catch (error) {
				taken.add(name);
				console.warn(
					`[obsidian-layer-base] "${path}" is unavailable, trying the next name:`,
					error,
				);
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return file;
			}
			throw new Error(`Created file could not be retrieved: ${path}`);
		}

		throw new Error(
			`Could not find an unused name after ${MAX_NAME_ATTEMPTS} attempts`,
		);
	}

	async load(file: TFile): Promise<LoadedLayer> {
		const text = await this.app.vault.cachedRead(file);
		return parseLayerDoc(text);
	}

	private takenNamesIn(folder: TFolder | null): Set<string> {
		const target = folder ?? this.app.vault.getRoot();
		const taken = new Set<string>();
		for (const child of target.children) {
			if (child instanceof TFile && child.extension === LAYER_EXTENSION) {
				taken.add(child.basename);
			}
		}
		return taken;
	}
}

/** True when the file is one this plugin can open. */
export function isLayerFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === LAYER_EXTENSION;
}
