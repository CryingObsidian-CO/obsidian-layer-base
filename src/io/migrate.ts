import { LAYER_FORMAT_VERSION } from '../types';

/**
 * Brings an older on-disk object up to the current shape.
 *
 * Migrations run before validation and must be forgiving: they receive the raw
 * parsed object, so they only rename or add keys and never assume a field is
 * well formed. Anything they cannot explain is left for `schema.ts` to report.
 *
 * Every migration step appends to `warnings` so the user learns that their file
 * was rewritten rather than having it happen silently.
 */
export function migrate(
	raw: Record<string, unknown>,
	warnings: string[],
): Record<string, unknown> {
	const version = typeof raw.version === 'number' && Number.isFinite(raw.version)
		? raw.version
		: 0;

	if (version === LAYER_FORMAT_VERSION) {
		return raw;
	}

	// No released format predates v1 yet. When v2 lands, chain the steps here:
	//   const migrated = migrateV1toV2(raw);
	//   warnings.push(...);
	//   return migrated;
	warnings.push(
		`File version is ${version}; it was read as the current format (v${LAYER_FORMAT_VERSION}).`,
	);

	const migrated: Record<string, unknown> = { ...raw, version: LAYER_FORMAT_VERSION };
	return migrated;
}