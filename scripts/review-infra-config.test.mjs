import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8"));
}

test("review scripts use browser mode and the dev-process doctor", async () => {
  const pkg = await json("package.json");
  assert.equal(pkg.scripts["review:ui"], "node ./scripts/review-ui.mjs");
  assert.equal(pkg.scripts["review:native:doctor"], "node ./scripts/native-review-doctor.mjs");
  assert.equal(pkg.scripts["test:infra"], "node --test ./scripts/*.test.mjs");
  assert.equal(pkg.scripts["review:build"], undefined);
  assert.equal(pkg.scripts["review:app"], undefined);
});

test("browser review bypasses proxies for loopback WebDriver traffic", async () => {
  const config = await readFile(new URL("wdio.browser.conf.ts", root), "utf8");
  assert.match(config, /\["NO_PROXY", "no_proxy"\]/);
  assert.match(config, /entries\.add\("127\.0\.0\.1"\)/);
  assert.match(config, /entries\.add\("localhost"\)/);
});

test("WDIO Rust plugins are optional and gated by the e2e-wdio feature", async () => {
  const cargo = await readFile(new URL("src-tauri/Cargo.toml", root), "utf8");
  const lib = await readFile(new URL("src-tauri/src/lib.rs", root), "utf8");
  assert.match(cargo, /e2e-wdio\s*=\s*\["dep:tauri-plugin-wdio",\s*"dep:tauri-plugin-wdio-webdriver"\]/);
  assert.match(cargo, /tauri-plugin-wdio\s*=\s*\{\s*version\s*=\s*"1",\s*optional\s*=\s*true\s*\}/);
  assert.match(cargo, /tauri-plugin-wdio-webdriver\s*=\s*\{\s*version\s*=\s*"1",\s*optional\s*=\s*true\s*\}/);
  assert.match(lib, /#\[cfg\(all\(debug_assertions, feature = "e2e-wdio"\)\)\]/);
});

test("review-only capability is excluded from the normal application config", async () => {
  const baseConfig = await json("src-tauri/tauri.conf.json");
  const reviewConfig = await json("src-tauri/tauri.review.conf.json");
  const defaultCapability = await json("src-tauri/capabilities/default.json");
  const reviewCapability = reviewConfig.app.security.capabilities[1];

  assert.deepEqual(baseConfig.app.security.capabilities, ["default"]);
  assert.equal(reviewConfig.app.security.capabilities[0], "default");
  assert.equal(defaultCapability.permissions.includes("wdio:default"), false);
  assert.deepEqual(reviewCapability.permissions, ["wdio:default"]);
  assert.deepEqual(reviewCapability.windows, ["main"]);
});
