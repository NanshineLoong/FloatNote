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

  it("keeps narrow diffs side by side with horizontal scrolling", () => {
    expect(css).toMatch(/\.perm-diff-scroll\s*\{[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.perm-diff\s*\{[^}]*grid-template-columns:\s*minmax\(320px, 1fr\) minmax\(320px, 1fr\);[^}]*min-width:\s*640px;/s);
  });
});
