import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSkillPaths,
  listSkills,
  readSkillBody,
  formatSkillsForSystemPrompt,
} from "./skills.js";

/** Materialize a skill directory with SKILL.md (frontmatter + body). */
function writeSkill(root: string, name: string, frontmatter: string, body: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "floatnote-skills-"));
}

describe("skills module", () => {
  let root: string;
  beforeEach(() => {
    root = tempRoot();
    // reset module state to empty before each test
    loadSkillPaths([]);
  });

  it("enumerates loaded skills with name + description", () => {
    writeSkill(root, "socratic-review", 'name: socratic-review\ndescription: 苏格拉底式追问当前 piece', "正文指南");
    loadSkillPaths([root]);
    expect(listSkills()).toEqual([{ name: "socratic-review", description: "苏格拉底式追问当前 piece" }]);
  });

  it("skips skills missing a description (Pi standard behavior)", () => {
    writeSkill(root, "no-desc", "name: no-desc", "正文");
    writeSkill(root, "with-desc", 'name: with-desc\ndescription: 有描述', "正文");
    loadSkillPaths([root]);
    expect(listSkills().map((s) => s.name)).toEqual(["with-desc"]);
  });

  it("readSkillBody returns full SKILL.md text for a known name", () => {
    writeSkill(root, "structure-piece", 'name: structure-piece\ndescription: 组织 piece 结构', "# 指南\n做这件事");
    loadSkillPaths([root]);
    const body = readSkillBody("structure-piece");
    expect(body).toContain("---");
    expect(body).toContain("name: structure-piece");
    expect(body).toContain("# 指南");
  });

  it("readSkillBody returns null for an unknown name", () => {
    loadSkillPaths([root]);
    expect(readSkillBody("does-not-exist")).toBeNull();
  });

  it("readSkillBody accepts a name, not a path (no traversal)", () => {
    writeSkill(root, "real", 'name: real\ndescription: real', "正文");
    loadSkillPaths([root]);
    // a path-like string is just an unknown name → null, never reads the file
    expect(readSkillBody(join(root, "real", "SKILL.md"))).toBeNull();
  });

  it("formatSkillsForSystemPrompt contains each skill description (XML)", () => {
    writeSkill(root, "socratic-review", 'name: socratic-review\ndescription: 追问薄弱处', "正文");
    writeSkill(root, "inbox-to-actions", 'name: inbox-to-actions\ndescription: 提炼行动项', "正文");
    loadSkillPaths([root]);
    const out = formatSkillsForSystemPrompt();
    expect(out).toContain("available_skills");
    expect(out).toContain("追问薄弱处");
    expect(out).toContain("提炼行动项");
  });

  it("formatSkillsForSystemPrompt is empty when no skills loaded", () => {
    loadSkillPaths([root]);
    expect(formatSkillsForSystemPrompt()).toBe("");
  });

  it("aggregates across multiple directories", () => {
    const rootA = tempRoot();
    const rootB = tempRoot();
    writeSkill(rootA, "skill-a", 'name: skill-a\ndescription: A', "正文");
    writeSkill(rootB, "skill-b", 'name: skill-b\ndescription: B', "正文");
    loadSkillPaths([rootA, rootB]);
    expect(listSkills().map((s) => s.name).sort()).toEqual(["skill-a", "skill-b"]);
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  it("dedupes by name keeping the first occurrence", () => {
    const rootA = tempRoot();
    const rootB = tempRoot();
    writeSkill(rootA, "dup", 'name: dup\ndescription: 来自 A', "正文 A");
    writeSkill(rootB, "dup", 'name: dup\ndescription: 来自 B', "正文 B");
    loadSkillPaths([rootA, rootB]);
    expect(listSkills()).toEqual([{ name: "dup", description: "来自 A" }]);
    expect(readSkillBody("dup")).toContain("正文 A");
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  it("missing/empty directories contribute no skills and do not throw", () => {
    expect(() => loadSkillPaths([join(root, "does-not-exist"), ""])).not.toThrow();
    expect(listSkills()).toEqual([]);
  });

  it("excludes disable-model-invocation skills from the prompt but keeps them listed", () => {
    // Pi excludes disableModelInvocation skills from formatSkillsForPrompt.
    writeSkill(root, "explicit-only", 'name: explicit-only\ndescription: 仅显式\ndisable-model-invocation: true', "正文");
    writeSkill(root, "auto", 'name: auto\ndescription: 自动', "正文");
    loadSkillPaths([root]);
    const prompt = formatSkillsForSystemPrompt();
    expect(prompt).toContain("自动");
    expect(prompt).not.toContain("仅显式");
    // but listSkills still surfaces it for the picker
    expect(listSkills().map((s) => s.name)).toContain("explicit-only");
  });

  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});
