import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SessionSkillView, SkillRegistry } from "../skills.js";
import { WorkspaceClient } from "./types.js";
import { createReadOnlyWorkspaceTools } from "./tools.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "floatnote-workspace-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("read-only workspace tools", () => {
  it("lists, finds, reads, and greps only host-listed notes", async () => {
    const rawInbox = '<!-- floatnote:tags:v2 verify="待验证"|c=#ffcc00 -->\nhello tagged';
    const client = new WorkspaceClient({
      async list() {
        return [
          { path: "_inbox.md", kind: "inbox" },
          { path: "Ideas.md", kind: "piece" },
        ];
      },
      async read(notePath) {
        if (notePath === "_inbox.md") return rawInbox;
        if (notePath === "Ideas.md") return "one\ntwo";
        throw new Error("unexpected host path");
      },
    }, new SessionSkillView(new SkillRegistry().snapshot()));
    const tools = createReadOnlyWorkspaceTools({ workspace: client });
    const ls = await findTool(tools, "ls").execute("l1", {}, undefined, undefined, {} as never);
    expect(JSON.parse((ls.content[0] as { text: string }).text)).toEqual({
      workspace: {
        kind: "floatnote_project",
        layout: "flat",
        addressing: "note identifiers are relative to this already-selected project",
      },
      notes: [
        { path: "_inbox.md", kind: "inbox" },
        { path: "Ideas.md", kind: "piece" },
      ],
    });
    const find = await findTool(tools, "find").execute("f1", { pattern: "I*.md" } as never, undefined, undefined, {} as never);
    expect((find.content[0] as { text: string }).text).toBe("Ideas.md");
    const read = await findTool(tools, "read").execute("r1", { path: "_inbox.md" } as never, undefined, undefined, {} as never);
    expect(read.content).toHaveLength(2);
    expect((read.content[0] as { text: string }).text).toBe("hello tagged");
    expect(JSON.stringify(read.content)).not.toContain("floatnote:tags:v2");
    const grep = await findTool(tools, "grep").execute("g1", { pattern: "tagged", literal: true } as never, undefined, undefined, {} as never);
    expect((grep.content[0] as { text: string }).text).toContain("_inbox.md:1:hello tagged");
  });

  it("read rejects an unlisted project path and a Skill escape", async () => {
    const skillRoot = tempRoot();
    const skillDir = path.join(skillRoot, "review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review\ndescription: review\n---\nbody");
    const outside = tempRoot();
    const outsideSkill = path.join(outside, "secret.md");
    writeFileSync(outsideSkill, "secret");
    const view = new SessionSkillView(new SkillRegistry().replace([skillRoot], []));
    const client = new WorkspaceClient({
      async list() { return [{ path: "Ideas.md", kind: "piece" }]; },
      async read() { return "body"; },
    }, view);
    const read = findTool(createReadOnlyWorkspaceTools({ workspace: client }), "read");
    await expect(read.execute("c1", { path: "../secret.md" } as never, undefined, undefined, {} as never))
      .rejects.toThrow("当前项目");
    await expect(read.execute("c2", { path: outsideSkill } as never, undefined, undefined, {} as never))
      .rejects.toThrow("不可读取");
  });
});
