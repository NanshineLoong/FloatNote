/**
 * 助手聊天 render 根：薄 re-export，保持 `import ... from "./render"` 可用。
 *
 * 状态机（类型 + `reduceEvents` 纯函数）见 `./state`；DOM 渲染
 * （`renderMessage`/`renderBlock`）见 `./view`。
 */
export {
  type ChatEvent,
  type Block,
  type ChatMessage,
  type ChatState,
  emptyChat,
  isChatStreaming,
  processGroupSummary,
  reduceEvents,
} from "./state";

export { decorateCodeBlocks, renderMessage, renderBlock, startUserMessageEdit, type AssistantOutputMode } from "./view";
