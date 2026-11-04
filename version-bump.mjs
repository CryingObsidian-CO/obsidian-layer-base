import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;
/*
 * Only npm sets this, and only for a script it started: run this by hand without
 * the prefix and the value is undefined. That used to pass straight through —
 * `JSON.stringify` drops an undefined value, so manifest.json was rewritten with
 * no version at all, and versions.json gained an entry keyed "undefined". Both are
 * written before anyone could notice, so refuse here instead.
 */
if (!targetVersion) {
	console.error(
		'version-bump: npm_package_version is not set. Run it through npm, as `npm version patch` does, ' +
			'or give it yourself: npm_package_version=<version> node version-bump.mjs',
	);
	process.exit(1);
}

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
}
