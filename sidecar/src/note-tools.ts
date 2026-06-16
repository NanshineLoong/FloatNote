import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/** Result of asking the host to apply a note write. */
export interface WriteResult {
  ok: boolean;
  version?: number;
  error?: string;
}

export interface NoteToolDeps {
  /** Returns the full text of the note currently in context. */
  getNoteText: () => string;
  /** Ask the host to snapshot + overwrite the note; resolves with the outcome. */
  requestWrite: (content: string) => Promise<WriteResult>;
}

/**
 * Build the two custom tools exposed to the tutor agent.
 *
 * Writes are *delegated*: `write_note` never touches the filesystem — it asks
 * the host (via `requestWrite`) to snapshot the old version and persist the new
 * content, keeping Rust as the single source of truth.
 */
export function createNoteTools(deps: NoteToolDeps): ToolDefinition[] {
  const readNote = defineTool({
    name: "read_note",
    label: "Read note",
    description: "读取用户当前这篇笔记的全文。",
    parameters: Type.Object({}),
    promptSnippet: "read_note — 读取当前笔记全文",
    async execute() {
      return {
        content: [{ type: "text", text: deps.getNoteText() }],
        details: {},
      };
    },
  });

  const writeNote = defineTool({
    name: "write_note",
    label: "Write note",
    description:
      "用新的全文整篇覆盖用户当前笔记。系统会在覆盖前自动留存旧版本快照，用户可回退。",
    parameters: Type.Object({
      content: Type.String({ description: "笔记的新全文（整篇覆盖）。" }),
    }),
    promptSnippet: "write_note — 用新全文覆盖当前笔记（自动留版本）",
    async execute(_toolCallId, params) {
      const result = await deps.requestWrite(params.content);
      if (result.ok) {
        const version = result.version ?? "?";
        return {
          content: [{ type: "text", text: `已更新笔记，版本 v${version}` }],
          details: {},
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `写入笔记失败：${result.error ?? "未知错误"}`,
          },
        ],
        details: {},
      };
    },
  });

  return [readNote, writeNote];
}
