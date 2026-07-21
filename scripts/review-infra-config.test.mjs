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

test("bundled agent resources map directly beneath Tauri's resource directory", async () => {
  const config = await json("src-tauri/tauri.conf.json");
  const runner = await readFile(new URL("src-tauri/src/agent/runner.rs", root), "utf8");

  assert.deepEqual(config.bundle.resources, {
    "resources/sidecar/": "sidecar/",
    "resources/skills/": "skills/",
  });
  assert.match(runner, /resource_dir\(\)[\s\S]*?\.join\("sidecar"\)/);
  assert.match(runner, /resource_dir\(\)[\s\S]*?\.join\("skills"\)/);
});

test("preview releases use the root package version, DMG bundles, and ad-hoc signing", async () => {
  const pkg = await json("package.json");
  const config = await json("src-tauri/tauri.conf.json");

  assert.equal(pkg.scripts["version:check"], "node ./scripts/release-version.mjs check");
  assert.equal(pkg.scripts["version:set"], "node ./scripts/release-version.mjs set");
  assert.equal(config.version, "../package.json");
  assert.equal(config.bundle.targets, "dmg");
  assert.equal(config.bundle.macOS.signingIdentity, "-");
});

test("GitHub Actions validate changes and publish both native macOS architectures", async () => {
  const pkg = await json("package.json");
  const ci = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
  const release = await readFile(new URL(".github/workflows/release.yml", root), "utf8");
  const rustJob = ci.match(/(?:^|\n)  rust:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|$)/)?.[0];

  assert.equal(pkg.scripts["ci:local"], "node ./scripts/local-ci.mjs ci");
  assert.equal(pkg.scripts["release:check"], "node ./scripts/local-ci.mjs release");
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run check/);
  assert.ok(rustJob, "CI must define a rust job");
  assert.match(
    rustJob,
    /actions\/setup-node@v4[\s\S]*?npm ci[\s\S]*?npm run package:sidecar[\s\S]*?cargo test --lib/,
  );
  assert.match(ci, /cargo test --lib/);
  assert.match(ci, /cargo check --release/);

  assert.match(release, /tags:[\s\S]*?- "v\*"/);
  assert.match(release, /macos-15-intel/);
  assert.match(release, /macos-15/);
  assert.match(release, /aarch64-apple-darwin/);
  assert.match(release, /x86_64-apple-darwin/);
  assert.match(release, /tauri-apps\/tauri-action@v1/);
  assert.match(release, /releaseDraft: true/);
  assert.match(release, /prerelease: true/);
  assert.match(release, /generate_release_notes=true/);
  assert.match(release, /releaseAssetNamePattern:.*\$\{\{ matrix\.arch \}\}/);
  assert.match(release, /prepare_release:/);
  assert.match(release, /gh api --method POST/);
  assert.match(release, /gh api --paginate/);
  assert.doesNotMatch(release, /releases\/tags\/\$RELEASE_TAG/);
  assert.match(release, /needs: prepare_release/);
  assert.match(release, /releaseId: \$\{\{ needs\.prepare_release\.outputs\.release_id \}\}/);
});
