import {LAYER_FORMAT_VERSION} from '../types';

export function migrate(
	raw: Record<string, unknown>,
	warnings: string[],
): Record<string, unknown> {
	const version =
		typeof raw.version === 'number' && Number.isFinite(raw.version)
			? raw.version
			: 0;

	if (version === LAYER_FORMAT_VERSION) {
		return raw;
	}

	warnings.push(
		`File version is ${version}; it was read as the current format (v${LAYER_FORMAT_VERSION}).`,
	);

	return {
		...raw,
		version: LAYER_FORMAT_VERSION,
	};
}
