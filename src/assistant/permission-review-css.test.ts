import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("permission review CSS", () => {
  it("shares one dock inset between dock padding and the permission region", () => {
    expect(css).toMatch(/\.assistant-dock\s*\{[^}]*--assistant-dock-inset:\s*14px;[^}]*padding:\s*10px var\(--assistant-dock-inset\) 14px;/s);
    expect(css).toMatch(/\.assistant-perm-region\s*\{[^}]*left:\s*var\(--assistant-dock-inset\);[^}]*right:\s*var\(--assistant-dock-inset\);/s);
  });

  it("keeps review paper geometry aligned with the focused input paper", () => {
    expect(css).toMatch(/\.perm-dialog-paper\s*\{[^}]*width:\s*min\(920px, calc\(100vw - 32px\)\);[^}]*height:\s*min\(720px, calc\(100vh - 64px\)\);/s);
  });

  it("switches from unified to side-by-side diff at a 680px review-container width", () => {
    expect(css).toMatch(/\.perm-review-container\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(css).toMatch(/@container\s*\(min-width:\s*680px\)/s);
    expect(css).not.toMatch(/\.perm-diff\s*\{[^}]*min-width:\s*640px;/s);
    expect(css).toMatch(/\.perm-diff-unified\s*\{[^}]*display:\s*block;/s);
    expect(css).toMatch(/@container\s*\(min-width:\s*680px\)\s*\{[\s\S]*?\.perm-diff-wide\s*\{[^}]*display:\s*grid;/s);
  });

  it("caps expanded tag target text at six lines with contained vertical scrolling", () => {
    expect(css).toMatch(/\.perm-tag-target-full\s*\{[^}]*max-height:\s*calc\(6 \* 1\.5em \+ 16px \+ 2px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
  });

  it("constrains responsive diff fallbacks to the review panel scrollport", () => {
    expect(css).toMatch(/\.perm-diff-fallbacks\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  });

  it("keeps review tabs fixed above one scrollable panel", () => {
    expect(css).toMatch(/\.perm-dialog-body\.has-tabs\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s);
    expect(css).toMatch(/\.perm-review-panel\s*\{[^}]*overflow:\s*hidden;/s);
  });

  it("makes Markdown tables and code blocks scroll without widening their surface", () => {
    expect(css).toMatch(/\.fn-markdown table\s*\{[^}]*min-width:\s*100%;/s);
    expect(css).toMatch(/\.fn-markdown pre\s*\{[^}]*overflow-x:\s*auto;/s);
  });
});
