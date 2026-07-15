/**
 * Line-delimited JSON (JSONL) protocol shared with the Rust host (Sprint 3).
 *
 * Every message is one JSON object on its own line. `type` discriminates.
 * The host writes HostToSidecar lines to the sidecar's stdin; the sidecar
 * writes SidecarToHost lines to stdout.
 */

import type { AiProviderId } from "./model.js";

/** Host → sidecar messages. */
export type HostToSidecar =
  | {
      type: "configure";
      callId: string;
      provider: AiProviderId;
      model: string;
      apiKey?: string;
      baseUrl?: string;
    }
  | { type: "clear_configuration"; callId: string }
  | { type: "configuration_ready" }
  | {
      type: "open_session";
      conversationId: string;
      sessionFile: string;
    }
  | {
      type: "new_session";
      conversationId: string;
      cwd: string;
      sessionDir: string;
    }
  | {
      type: "prompt";
      requestId: string;
      conversationId: string;
      userText: string;
      /** 结构化引用（文件/Skill），由前端 chip 转换而来。userText 只含可见正文。 */
      references?: PromptRef[];
      /** 首个 Skill 引用（稳定 name），sidecar 用 /skill:name 前缀原生展开。 */
      skill?: { name: string };
    }
  | { type: "rewind"; callId: string; conversationId: string; userEntryId: string }
  | {
      type: "apply_edit_result";
      callId: string;
      ok: boolean;
      denied?: boolean;
      version?: number;
      error?: string;
    }
  | { type: "note_text"; callId: string; content: string; found: boolean }
  | { type: "notes_list"; callId: string; notes: Array<{ kind: "inbox" | "tasks" | "piece"; name: string }> }
  | { type: "create_note_result"; callId: string; ok: boolean; denied?: boolean; name?: string; error?: string }
  | {
      type: "cancel";
      requestId: string;
    }
  | {
      /** Host requests the sidecar's loaded skill list (synchronous one-shot). */
      type: "list_skills";
      callId: string;
    }
  | {
      /** Host delivers skill directories for the sidecar to load at startup. */
      type: "set_skill_paths";
      skillPaths: string[];
      disabledSkillNames?: string[];
    };

export type NoteTarget = { kind: "inbox" | "tasks" | "piece"; name?: string };

/** prompt 携带的结构化引用：显示名(display) 与内部标识(id) 分离。 */
export interface PromptRef {
  kind: "file" | "skill";
  id: string;
  display: string;
  noteKind?: "inbox" | "tasks" | "piece" | "doc";
}

export type EditPreviewDetail =
  | { kind: "diff"; hunks: string }
  | { kind: "tag_assign"; textExcerpt: string; annotationCount: number; action: "add" | "remove"; tagName: string; tagColor: string }
  | { kind: "tag_create"; tagName: string; tagColor: string }
  | { kind: "tag_update"; tagId: string; oldName: string; oldColor: string; newName: string; newColor: string }
  | { kind: "note_create"; filename: string; contentPreview: string }
  | { kind: "tag_delete"; tagName: string; annotationCount: number };

export interface EditPreview {
  tool: string;
  summary: string;
  detail: EditPreviewDetail;
}

/** Sidecar → host messages. */
export type SidecarToHost =
  | { type: "ready" }
  | { type: "configure_result"; callId: string; ok: boolean; error?: string }
  | {
      type: "session_opened";
      conversationId: string;
      sessionFile: string;
      messages: ChatDisplayMessage[];
    }
  | {
      type: "session_synced";
      conversationId: string;
      sessionFile: string;
      messages: ChatDisplayMessage[];
    }
  | { type: "rewind_result"; callId: string; ok: boolean; error?: string }
  | { type: "delta"; requestId: string; conversationId: string; text: string }
  | {
      type: "thinking_start";
      requestId: string;
      conversationId: string;
      blockId: string;
    }
  | { type: "thinking_delta"; requestId: string; conversationId: string; text: string }
  | { type: "thinking_end"; requestId: string; conversationId: string }
  | {
      type: "tool";
      requestId: string;
      conversationId: string;
      callId: string;
      name: string;
      phase: "prepare" | "start" | "end";
      label?: string;
      error?: string;
      isError?: boolean;
    }
  | {
      type: "apply_edit";
      callId: string;
      conversationId: string;
      toolCallId?: string;
      /** 目标笔记；缺省=当前活动笔记（由 Rust 解析）。仅当调用方显式指定时携带。 */
      target?: NoteTarget;
      toolName: string;
      oldContent: string;
      newContent: string;
      preview: EditPreview;
    }
  | { type: "get_note_text"; callId: string; conversationId: string; target?: NoteTarget }
  | { type: "list_notes"; callId: string; conversationId: string }
  | { type: "create_note"; callId: string; conversationId: string; toolCallId: string; title: string; content: string; preview: EditPreview }
  | {
      type: "done";
      requestId: string;
      conversationId: string;
      outcome: "completed" | "cancelled" | "failed";
      error?: string;
    }
  | { type: "title"; conversationId: string; title: string }
  | { type: "error"; requestId: string | null; conversationId?: string; message: string }
  | {
      /** Sidecar replies to `list_skills` with the loaded skill summaries. */
      type: "skills_list";
      callId: string;
      skills: { name: string; description: string }[];
    };

export type ChatDisplayMessage =
  | { role: "user"; text: string; timestamp: number; entryId?: string }
  | { role: "assistant"; blocks: ChatDisplayBlock[]; timestamp: number; entryId?: string }
  | { role: "error"; text: string; timestamp: number; entryId?: string };

export type ChatDisplayBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; callId: string; name: string; label: string; status: "succeeded" | "failed" | "incomplete"; error?: string };

/**
 * Encode a message as a single newline-terminated JSON line.
 * `JSON.stringify` already escapes embedded newlines, so the payload never
 * spans multiple lines.
 */
export function encodeLine(msg: SidecarToHost | HostToSidecar): string {
  return JSON.stringify(msg) + "\n";
}

/**
 * Create a stateful decoder that accumulates incoming chunks, splits on `\n`,
 * parses each complete line, and keeps any trailing partial line buffered for
 * the next call. Blank lines are ignored.
 *
 * Typed for the host→sidecar direction (the sidecar's input).
 */
export function createLineDecoder(): (chunk: string) => HostToSidecar[] {
  let buffer = "";
  return (chunk: string): HostToSidecar[] => {
    buffer += chunk;
    const out: HostToSidecar[] = [];
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        out.push(JSON.parse(trimmed) as HostToSidecar);
      }
      newlineIndex = buffer.indexOf("\n");
    }
    return out;
  };
}
