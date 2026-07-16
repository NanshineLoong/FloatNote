import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createDefaultWebTools } from "../web-tools.js";

export function createWebExtension(): InlineExtension {
  return {
    name: "floatnote-web",
    factory(pi) {
      for (const tool of createDefaultWebTools()) pi.registerTool(tool);
    },
  };
}
