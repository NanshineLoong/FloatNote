import { type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SidecarToHost } from "./protocol.js";
import { formatToolTitle, sanitizeToolError } from "./tool-title.js";

/**
 * Translate a Pi agent-session event into a single protocol line, or null when
 * the event is not relevant to the host. We forward text + thinking blocks
 * (streamed into the chat bubble) and tool execution start/end; toolcall_*
 * (the model emitting a tool-call block) is dropped — the action card's
 * structured detail arrives via the permission://request flow instead.
 */
export function translateEvent(
  requestId: string,
  conversationId: string,
  event: AgentSessionEvent,
): SidecarToHost | null {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        return { type: "delta", requestId, conversationId, text: inner.delta };
      }
      if (inner.type === "thinking_start") {
        return { type: "thinking_start", requestId, conversationId, blockId: `${requestId}-t${inner.contentIndex}` };
      }
      if (inner.type === "thinking_delta") {
        return { type: "thinking_delta", requestId, conversationId, text: inner.delta };
      }
      if (inner.type === "thinking_end") {
        return { type: "thinking_end", requestId, conversationId };
      }
      return null;
    }
    case "tool_execution_start":
      return { type: "tool", requestId, conversationId, callId: event.toolCallId, name: event.toolName, label: formatToolTitle(event.toolName, event.args), phase: "start" };
    case "tool_execution_end":
      const error = event.isError ? sanitizeToolError(event.result) : undefined;
      return {
        type: "tool",
        requestId,
        conversationId,
        callId: event.toolCallId,
        name: event.toolName,
        phase: "end",
        isError: event.isError,
        ...(error ? { error } : {}),
      };
    case "agent_end": {
      if (event.willRetry) return null;
      const assistant = [...event.messages].reverse().find(
        (message) => "role" in message && message.role === "assistant",
      );
      const outcome = assistant && "stopReason" in assistant
        ? assistant.stopReason === "aborted"
          ? "cancelled"
          : assistant.stopReason === "error"
            ? "failed"
            : "completed"
        : "completed";
      const error = outcome === "failed" && assistant && "errorMessage" in assistant
        ? assistant.errorMessage
        : undefined;
      return { type: "done", requestId, conversationId, outcome, ...(error ? { error } : {}) };
    }
    default:
      return null;
  }
}
