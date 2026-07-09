/**
 * Line-delimited JSON (JSONL) protocol shared with the Rust host (Sprint 3).
 *
 * Every message is one JSON object on its own line. `type` discriminates.
 * The host writes HostToSidecar lines to the sidecar's stdin; the sidecar
 * writes SidecarToHost lines to stdout.
 */

/** Host → sidecar messages. */
export type HostToSidecar =
  | {
      type: "configure";
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
    }
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
    }
  | {
      type: "apply_edit_result";
      callId: string;
      ok: boolean;
      denied?: boolean;
      version?: number;
      error?: string;
    }
  | { type: "note_text"; callId: string; content: string; found: boolean }
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
    };

export type NoteTarget = { kind: "inbox" | "tasks" | "piece" | "doc"; name?: string };

export type EditPreviewDetail =
  | { kind: "diff"; hunks: string }
  | { kind: "tag_assign"; blockPreview: string; tagName: string; tagColor: string }
  | { kind: "tag_create"; tagName: string; tagColor: string }
  | { kind: "tag_delete"; tagName: string; markerCount: number };

export interface EditPreview {
  tool: string;
  summary: string;
  detail: EditPreviewDetail;
}

/** Sidecar → host messages. */
export type SidecarToHost =
  | { type: "ready" }
  | {
      type: "session_opened";
      conversationId: string;
      sessionFile: string;
      messages: ChatDisplayMessage[];
    }
  | { type: "delta"; requestId: string; conversationId: string; text: string }
  | {
      type: "tool";
      requestId: string;
      conversationId: string;
      name: string;
      phase: "start" | "end";
    }
  | {
      type: "apply_edit";
      callId: string;
      conversationId: string;
      /** 目标笔记；缺省=当前活动笔记（由 Rust 解析）。仅当调用方显式指定时携带。 */
      target?: NoteTarget;
      toolName: string;
      oldContent: string;
      newContent: string;
      preview: EditPreview;
    }
  | { type: "get_note_text"; callId: string; conversationId: string; target?: NoteTarget }
  | { type: "done"; requestId: string; conversationId: string }
  | { type: "title"; conversationId: string; title: string }
  | { type: "error"; requestId: string | null; conversationId?: string; message: string }
  | {
      /** Sidecar replies to `list_skills` with the loaded skill summaries. */
      type: "skills_list";
      callId: string;
      skills: { name: string; description: string }[];
    };

export type ChatDisplayMessage =
  | { role: "user"; text: string; timestamp: number }
  | { role: "assistant"; text: string; timestamp: number }
  | { role: "tool"; label: string; timestamp: number }
  | { role: "error"; text: string; timestamp: number };

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
