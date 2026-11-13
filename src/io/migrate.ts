import {LAYER_FORMAT_VERSION} from '../types';

/** The format version a file declares, or 0 when it declares none, so a missing version is announced
 * rather than passing for a current one. */
export function fileVersion(raw: Record<string, unknown>): number {
	return typeof raw.version === 'number' && Number.isFinite(raw.version)
		? raw.version
		: 0;
}

/** A file written by a newer build. Reading it would mean writing it back without whatever the newer
 * format added, so it is refused — and thrown rather than returned, so no caller can ignore it. */
export class FutureVersionError extends Error {
	constructor(readonly version: number) {
		super(
			`File format v${version} is newer than this build (v${LAYER_FORMAT_VERSION}); it is left unread and unwritten.`,
		);
		this.name = 'FutureVersionError';
	}
}

export function migrate(
	raw: Record<string, unknown>,
	warnings: string[],
): Record<string, unknown> {
	const version = fileVersion(raw);
	if (version === LAYER_FORMAT_VERSION) {
		return raw;
	}

	warnings.push(
		`File version is ${version}; it was read as the current format (v${LAYER_FORMAT_VERSION}).`,
	);

	return raw;
}
