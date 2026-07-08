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
      type: "apply_write_result";
      callId: string;
      ok: boolean;
      version?: number;
      error?: string;
    }
  | {
      type: "cancel";
      requestId: string;
    };

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
      type: "apply_write";
      callId: string;
      noteId: string;
      content: string;
    }
  | { type: "done"; requestId: string; conversationId: string }
  | { type: "title"; conversationId: string; title: string }
  | { type: "error"; requestId: string | null; conversationId?: string; message: string };

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
