import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { decodeInbox } from "@floatnote/note-logic";
import type { EditPreview, MutationOperation, WorkspaceEntry } from "../protocol.js";
import type { SessionSkillView } from "../skills.js";
import { validateProjectPath } from "./path-policy.js";
import { projectInbox, projectMarkdown } from "./projection.js";

export interface ProjectedRead {
  markdown: string;
  context?: string;
  totalLines: number;
  nextOffset?: number;
}

export interface PreparedMutation {
  path: string;
  operation: MutationOperation;
  oldContent: string;
  newContent: string;
  createOnly: boolean;
  preview: EditPreview;
}

export interface WorkspaceHost {
  list(): Promise<WorkspaceEntry[]>;
  read(path: string): Promise<string>;
}

export class WorkspaceClient {
  constructor(
    private readonly host: WorkspaceHost,
    private readonly skillView: SessionSkillView,
  ) {}

  listEntries(): Promise<WorkspaceEntry[]> {
    return this.host.list();
  }

  async readRawProject(notePath: string): Promise<string> {
    const entries = await this.listEntries();
    validateProjectPath(notePath, entries.map((entry) => entry.path));
    return this.host.read(notePath);
  }

  async readCleanProject(notePath: string): Promise<string> {
    const raw = await this.readRawProject(notePath);
    return notePath === "_inbox.md" ? decodeInbox(raw).markdown : raw;
  }

  async readProjected(input: { path: string; offset?: number; limit?: number }): Promise<ProjectedRead> {
    const raw = await this.readRawProject(input.path);
    return input.path === "_inbox.md" ? projectInbox(raw, input) : projectMarkdown(raw, input);
  }

  async readSkill(skillPath: string, offset?: number, limit?: number): Promise<ProjectedRead> {
    const resolved = this.skillView.resolveReadableFile(skillPath);
    if (!resolved) throw new Error("该 Skill 资源不可读取或已停用");
    const size = statSync(resolved).size;
    if (size > 1024 * 1024) throw new Error("Skill 资源超过 1 MiB 限制");
    const bytes = await readFile(resolved);
    if (bytes.length > 1024 * 1024) throw new Error("Skill 资源超过 1 MiB 限制");
    if (bytes.includes(0)) throw new Error("Skill 资源不是文本文件");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Skill 资源不是有效 UTF-8 文本");
    }
    return projectMarkdown(text, { offset, limit });
  }

  async read(input: { path: string; offset?: number; limit?: number }): Promise<ProjectedRead> {
    const entries = await this.listEntries();
    if (entries.some((entry) => entry.path === input.path)) return this.readProjected(input);
    if (path.isAbsolute(input.path)) return this.readSkill(input.path, input.offset, input.limit);
    validateProjectPath(input.path, entries.map((entry) => entry.path));
    throw new Error("该文件不属于当前项目");
  }
}
