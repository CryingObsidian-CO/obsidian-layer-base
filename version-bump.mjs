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

/*
 * The MCP server announces a version of its own, and that copy lives in source rather than
 * in a version file. scripts/check-version.mjs compares it with the manifest, so bumping
 * the files that hold a version and leaving this one behind fails the release workflow.
 * Matched with the same pattern that check reads, so the two cannot disagree about what
 * counts as the announcement.
 */
const serverPath = 'mcp/server.ts';
const server = readFileSync(serverPath, 'utf8');
const announced = /(serverInfo:\s*\{[^}]*\bversion:\s*')([^']+)(')/;
if (!announced.test(server)) {
	console.error(
		`version-bump: ${serverPath} has no serverInfo version to update, so the released ` +
			'server would announce a version older than the plugin it shipped with.',
	);
	process.exit(1);
}
const bumped = server.replace(
	announced,
	(_match, before, _was, after) => `${before}${targetVersion}${after}`,
);

// Everything is read and checked before anything is written, so a refusal above leaves the
// tree exactly as it was rather than half-bumped.
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

if (bumped !== server) {
	writeFileSync(serverPath, bumped);
}
