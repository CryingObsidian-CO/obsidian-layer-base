import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;
// npm sets this only for a script it started; refuse rather than write "undefined" into the files.
if (!targetVersion) {
	console.error(
		'version-bump: npm_package_version is not set. Run it through npm, as `npm version patch` does, ' +
			'or give it yourself: npm_package_version=<version> node version-bump.mjs',
	);
	process.exit(1);
}

// The MCP server announces its own version; check-version compares it with the manifest.
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

// Check everything before writing, so a refusal leaves the tree untouched.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// Add the version only if it is not there yet.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
}

if (bumped !== server) {
	writeFileSync(serverPath, bumped);
}
