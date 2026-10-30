/**
 * Validate the release metadata and Supervisor discovery contract.
 *
 * The gateway is published in two Home Assistant-facing forms: the app/add-on
 * described by `config.yaml` and the custom integration described by its
 * manifest. The npm package also carries the release version. Keeping these
 * values aligned prevents Home Assistant from running an older app beside a
 * newer integration, which can leave an installation pointing at an obsolete
 * gateway hostname. This check deliberately uses only Node's standard library
 * so it can run in CI before dependency installation.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const gatewayDirectory = resolve(scriptDirectory, "..");

/**
 * Read a UTF-8 repository file relative to the gateway package directory.
 *
 * @param {string} relativePath - Path below `eufy_event_gateway`.
 * @returns {Promise<string>} The file contents.
 */
async function readRepositoryFile(relativePath) {
  return readFile(resolve(gatewayDirectory, relativePath), "utf8");
}

/**
 * Extract a simple top-level YAML scalar from the app metadata.
 *
 * `config.yaml` intentionally contains a small, stable metadata surface. A
 * full YAML dependency would make this pre-install guard needlessly fragile.
 *
 * @param {string} yaml - App metadata.
 * @param {string} key - Top-level key to locate.
 * @returns {string} The scalar value.
 */
function yamlScalar(yaml, key) {
  const match = yaml.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m"));
  if (!match) throw new Error(`Missing ${key} in eufy_event_gateway/config.yaml`);
  return match[1].trim();
}

/**
 * Stop the release when one of the public package versions drifts.
 *
 * @param {Record<string, string>} versions - Named release versions.
 * @returns {void}
 */
function assertVersionsMatch(versions) {
  const expected = Object.values(versions)[0];
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length === 0) return;

  const details = Object.entries(versions).map(([name, version]) => `  ${name}: ${version}`).join("\n");
  throw new Error(`Release versions do not match:\n${details}`);
}

/**
 * Require a changelog to announce the exact version being released.
 *
 * A heading check covers both publication surfaces without requiring their
 * prose to remain identical. This prevents the app UI from silently retaining
 * an older release history when the repository changelog is updated alone.
 *
 * @param {string} changelog - Markdown changelog contents.
 * @param {string} version - Release version shared by the public metadata.
 * @param {string} name - Human-readable path used in failure output.
 * @returns {void}
 */
function assertChangelogVersion(changelog, version, name) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+${escapedVersion}\\s*$`, "m");
  if (!heading.test(changelog)) {
    throw new Error(`${name} must contain a \"## ${version}\" release heading`);
  }
}

const packageJson = JSON.parse(await readRepositoryFile("package.json"));
const packageLock = JSON.parse(await readRepositoryFile("package-lock.json"));
const configYaml = await readRepositoryFile("config.yaml");
const manifest = JSON.parse(await readFile(resolve(gatewayDirectory, "..", "custom_components/eufy_mega_dev/manifest.json"), "utf8"));
const runScript = await readRepositoryFile("run.sh");
const appChangelog = await readRepositoryFile("CHANGELOG.md");
const repositoryChangelog = await readRepositoryFile("../CHANGELOG.md");

assertVersionsMatch({
  "package.json": packageJson.version,
  "package-lock.json": packageLock.version,
  "config.yaml": yamlScalar(configYaml, "version"),
  "custom integration manifest": manifest.version,
});

assertChangelogVersion(repositoryChangelog, packageJson.version, "CHANGELOG.md");
assertChangelogVersion(appChangelog, packageJson.version, "eufy_event_gateway/CHANGELOG.md");

if (runScript.includes("local-eufy-event-gateway")) {
  throw new Error("run.sh must not advertise the removed local-eufy-event-gateway hostname");
}

if (!runScript.includes('gateway_host="$(hostname)"')) {
  throw new Error("run.sh must advertise the Supervisor-assigned hostname");
}

console.log(`Release metadata is consistent at v${packageJson.version}.`);
