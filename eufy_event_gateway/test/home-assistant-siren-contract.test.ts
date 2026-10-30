/**
 * Protects the Home Assistant siren capability declaration without importing
 * Home Assistant into the gateway test environment. Home Assistant removes a
 * duration service argument unless the entity advertises DURATION support.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const integrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../custom_components/eufy_mega_dev/siren.py",
);

test("camera and HomeBase sirens advertise duration support", async () => {
  const source = await readFile(integrationPath, "utf8");
  const cameraClass = source.slice(
    source.indexOf("class EufyCameraSiren"),
    source.indexOf("class EufyHomeBaseSiren"),
  );
  const homeBaseClass = source.slice(source.indexOf("class EufyHomeBaseSiren"));

  assert.match(cameraClass, /_attr_supported_features[\s\S]*SirenEntityFeature\.DURATION/);
  assert.match(homeBaseClass, /_attr_supported_features[\s\S]*SirenEntityFeature\.DURATION/);
});
