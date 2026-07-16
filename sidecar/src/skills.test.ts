import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionSkillView, SkillRegistry } from "./skills.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "floatnote-skills-"));
  roots.push(root);
  return root;
}

function writeSkill(root: string, name: string, description = "追问"): string {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "references"), { recursive: true });
  writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n正文`,
  );
  writeFileSync(path.join(dir, "references", "guide.md"), "guide");
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SkillRegistry", () => {
  it("returns Pi Skill objects from one atomic snapshot", () => {
    const root = tempRoot();
    writeSkill(root, "socratic-review");
    const registry = new SkillRegistry();
    const snapshot = registry.replace([root], []);
    expect(snapshot.skills().map((skill) => skill.name)).toEqual(["socratic-review"]);
    expect(snapshot.summaries()).toEqual([{ name: "socratic-review", description: "追问" }]);
  });

  it("allows referenced text files only inside an enabled skill baseDir", () => {
    const root = tempRoot();
    const skillDir = writeSkill(root, "socratic-review");
    const outside = tempRoot();
    writeFileSync(path.join(outside, "secret.md"), "secret");
    const registry = new SkillRegistry();
    const snapshot = registry.replace([root], []);
    const skill = snapshot.skills()[0];
    expect(snapshot.resolveReadableFile(skill.filePath)).toBe(skill.filePath);
    expect(snapshot.resolveReadableFile(path.join(skill.baseDir, "references", "guide.md")))
      .toBe(path.join(skill.baseDir, "references", "guide.md"));
    expect(snapshot.resolveReadableFile(path.join(skill.baseDir, "..", "secret.md"))).toBeNull();
    symlinkSync(path.join(outside, "secret.md"), path.join(skillDir, "references", "escape.md"));
    expect(snapshot.resolveReadableFile(path.join(skillDir, "references", "escape.md"))).toBeNull();
  });

  it("keeps an active session on one complete snapshot until it swaps", () => {
    const root = tempRoot();
    writeSkill(root, "socratic-review");
    const registry = new SkillRegistry();
    const first = registry.replace([root], []);
    const view = new SessionSkillView(first);
    const file = first.skills()[0].filePath;
    const second = registry.replace([root], ["socratic-review"]);
    expect(view.resolveReadableFile(file)).toBe(file);
    view.replace(second);
    expect(view.resolveReadableFile(file)).toBeNull();
  });

  it("aggregates directories, filters disabled skills, and keeps the first duplicate", () => {
    const rootA = tempRoot();
    const rootB = tempRoot();
    writeSkill(rootA, "dup", "first");
    writeSkill(rootA, "disabled", "disabled");
    writeSkill(rootB, "dup", "second");
    writeSkill(rootB, "other", "other");
    const snapshot = new SkillRegistry().replace([rootA, rootB], ["disabled"]);
    expect(snapshot.summaries()).toEqual([
      { name: "dup", description: "first" },
      { name: "other", description: "other" },
    ]);
  });

  it("treats missing and empty paths as empty inputs", () => {
    const root = tempRoot();
    const registry = new SkillRegistry();
    expect(() => registry.replace([path.join(root, "missing"), ""], [])).not.toThrow();
    expect(registry.snapshot().skills()).toEqual([]);
  });
});
