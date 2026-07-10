import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

/** CSS files that should consume design tokens, not raw accent hex literals.
 * `editor.ts` CodeMirror highlighting is intentionally excluded (code-syntax
 * palette is a separate concern). `primitives.css` defines the ramp itself. */
const tokenizedCss = [
  "src/styles.css",
  "src/assistant/styles.css",
  "src/settings/styles.css",
  "src/popup/styles.css",
  "src/history/styles.css",
];

const windowHtml = ["index.html", "settings.html", "popup.html", "history.html"];

describe("design tokens", () => {
  it("defines the full indigo ramp in primitives.css", () => {
    const p = readFileSync(resolve(root, "src/styles/primitives.css"), "utf8");
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(p).toMatch(new RegExp(`--indigo-${step}:`));
    }
    // Locked primary + dark accent.
    expect(p).toContain("--indigo-600: #4f46e5");
    expect(p).toContain("--indigo-400: #818cf8");
  });

  it("exposes the accent semantic tokens in semantic.css", () => {
    const s = readFileSync(resolve(root, "src/styles/semantic.css"), "utf8");
    expect(s).toMatch(/--color-accent:\s*var\(--indigo-600\)/);
    expect(s).toMatch(/--color-accent-fill:/);
    expect(s).toMatch(/--color-focus-ring:/);
    // Dark block re-points accent to indigo-400.
    expect(s).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*--color-accent:\s*var\(--indigo-400\)/,
    );
  });

  it("has no raw #2563eb accent literal in tokenized CSS (comments stripped)", () => {
    for (const f of tokenizedCss) {
      const css = readFileSync(resolve(root, f), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      expect(css).not.toMatch(/#2563eb/i);
    }
  });

  it("links index.css from every window HTML head", () => {
    for (const f of windowHtml) {
      const h = readFileSync(resolve(root, f), "utf8");
      expect(h).toMatch(/href="\/src\/styles\/index\.css"/);
    }
  });

  it("aggregates the four token layers in index.css (import-only)", () => {
    const idx = readFileSync(resolve(root, "src/styles/index.css"), "utf8");
    // No bare rules — only @import (CSS spec requires @import first).
    expect(idx.replace(/\/\*[\s\S]*?\*\//g, "").trim()).not.toMatch(/^[^@]/m);
    for (const layer of ["primitives", "semantic", "base", "components"]) {
      expect(idx).toContain(`@import "./${layer}.css"`);
    }
  });
});
