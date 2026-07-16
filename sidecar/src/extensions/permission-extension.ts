import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { MutationCoordinator } from "../workspace/mutation-coordinator.js";

const MUTATION_TOOLS = new Set([
  "edit",
  "write",
  "tag_text",
  "tag_create",
  "tag_update",
  "tag_delete",
]);

export function createPermissionExtension(coordinator: MutationCoordinator): InlineExtension {
  return {
    name: "floatnote-permission",
    factory(pi) {
      pi.on("tool_call", async (event) => {
        if (!MUTATION_TOOLS.has(event.toolName)) return;
        try {
          await coordinator.prepareForHook(event.toolCallId, event.toolName, event.input);
        } catch (error) {
          return {
            block: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      });
    },
  };
}
