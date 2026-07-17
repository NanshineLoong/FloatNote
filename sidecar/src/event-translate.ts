import { type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SidecarToHost } from "./protocol.js";
import { formatToolPresentation, sanitizeToolError } from "./tool-title.js";

/**
 * Translate a Pi agent-session event into a single protocol line, or null when
 * the event is not relevant to the host. We forward text + thinking blocks
 * (streamed into the chat bubble), tool-call preparation, and tool execution
 * start/end. The preparation event opens an immediate semantic placeholder
 * based on the known tool name; execution start later enriches it with the
 * completed arguments.
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
      if (inner.type === "toolcall_start") {
        const block = (inner.partial.content?.[inner.contentIndex] ?? {}) as {
          id?: unknown;
          name?: unknown;
        };
        if (typeof block.id === "string" && typeof block.name === "string") {
          const presentation = formatToolPresentation(block.name, {});
          return {
            type: "tool",
            requestId,
            conversationId,
            callId: block.id,
            name: block.name,
            ...presentation,
            phase: "prepare",
          };
        }
      }
      return null;
    }
    case "tool_execution_start": {
      const presentation = formatToolPresentation(event.toolName, event.args);
      return { type: "tool", requestId, conversationId, callId: event.toolCallId, name: event.toolName, ...presentation, phase: "start" };
    }
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
