import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const iconUrl = new URL("../src-tauri/icons/app-icon.svg", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("macOS app icon source uses the approved full-bleed composition", () => {
  assert.equal(
    existsSync(iconUrl),
    true,
    `expected editable app icon source at ${fileURLToPath(iconUrl)}`,
  );

  const svg = readFileSync(iconUrl, "utf8");
  assert.match(svg, /<svg[^>]+viewBox="0 0 1024 1024"/);
  assert.match(
    svg,
    /<rect[^>]+id="background"[^>]+x="0"[^>]+y="0"[^>]+width="1024"[^>]+height="1024"/,
  );
  assert.doesNotMatch(svg, /id="background"[^>]+\brx=/);

  const paperWidth = Number(
    svg.match(/id="paper"[^>]+\swidth="([\d.]+)"/)?.[1],
  );
  assert.ok(
    paperWidth >= 748 && paperWidth <= 760,
    `expected paper width near 74% of the canvas, got ${paperWidth}`,
  );

  const shadowOpacity = Number(
    svg.match(/id="paper-shadow"[^>]+flood-opacity="([\d.]+)"/)?.[1],
  );
  assert.ok(
    shadowOpacity > 0 && shadowOpacity <= 0.3,
    `expected a restrained paper shadow, got ${shadowOpacity}`,
  );
});

test("package exposes one deterministic app icon generation command", () => {
  const packageJson = JSON.parse(readFileSync(packageUrl, "utf8"));
  assert.equal(
    packageJson.scripts?.["icon:generate"],
    "tauri icon src-tauri/icons/app-icon.svg -o src-tauri/icons",
  );
});
