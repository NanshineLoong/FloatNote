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

  it("exposes the danger semantic tokens (mirroring accent, light + dark)", () => {
    const s = readFileSync(resolve(root, "src/styles/semantic.css"), "utf8");
    for (const tok of [
      "--color-danger:",
      "--color-danger-hover:",
      "--color-danger-fill:",
      "--color-danger-fill-strong:",
    ]) {
      expect(s).toMatch(new RegExp(tok));
    }
    // Dark block re-points danger text to the lighter shade.
    expect(s).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*--color-danger:\s*var\(--danger-500\)/,
    );
    // primitives back the dark lighter shade.
    const p = readFileSync(resolve(root, "src/styles/primitives.css"), "utf8");
    expect(p).toContain("--danger-400:");
  });

  it("exposes a warning token for user-declined actions in both color schemes", () => {
    const s = readFileSync(resolve(root, "src/styles/semantic.css"), "utf8");
    expect(s).toMatch(/:root\s*\{[\s\S]*--color-warning:/);
    expect(s).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*--color-warning:/);
  });

  it("has no residual accent/danger rgba literals in window CSS", () => {
    // After migration, hover/selected/focus-ring/danger fills in window
    // styles go through semantic tokens — no raw rgba(37,99,235)/danger ramps.
    const banned = [
      "rgba(37, 99, 235",
      "rgba(96, 165, 250",
      "rgba(59, 130, 246",
      "rgba(220, 38, 38",
      "rgba(239, 68, 68",
      "rgba(248, 113, 113",
    ];
    for (const f of tokenizedCss) {
      const css = readFileSync(resolve(root, f), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      for (const lit of banned) {
        expect(css).not.toMatch(new RegExp(lit.replace(/[()]/g, "\\$&")));
      }
    }
  });

  it("has no per-window dark @media block (dark is centralized in semantic.css)", () => {
    for (const f of tokenizedCss) {
      const css = readFileSync(resolve(root, f), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      expect(css).not.toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    }
  });

  it("component layer never consumes primitives directly", () => {
    const c = readFileSync(resolve(root, "src/styles/components.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(c).not.toMatch(/var\(--indigo-/);
    expect(c).not.toMatch(/var\(--danger-/);
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
