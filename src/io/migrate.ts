import {LAYER_FORMAT_VERSION} from '../types';

/**
 * The format version a file declares, or 0 when it declares none.
 *
 * A missing or unusable version is read as 0 rather than assumed, so the file is
 * announced instead of quietly passing for a current one.
 */
export function fileVersion(raw: Record<string, unknown>): number {
	return typeof raw.version === 'number' && Number.isFinite(raw.version)
		? raw.version
		: 0;
}

/**
 * A file written by a newer build, which this one cannot read.
 *
 * Reading it anyway would mean writing it back: every unknown member is dropped
 * on the way in, so the next save would rebuild the file without them and lose
 * whatever the newer format added. Refusing is the only answer that keeps the
 * data, and it is thrown rather than returned so no caller can ignore it.
 */
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
