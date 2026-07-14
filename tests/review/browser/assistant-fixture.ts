import "@phosphor-icons/web/regular";
import "../../../src/styles/index.css";
import "../../../src/styles.css";
import "../../../src/assistant/styles.css";
import "./assistant-fixture.css";
import { mountAssistant } from "../../../src/assistant/assistant";
import type { ChatConversation } from "../../../src/platform/chat-history";

const root = document.querySelector<HTMLElement>("#assistant-region");
if (!root) throw new Error("assistant fixture root is missing");

const now = Date.now();
const conversation: ChatConversation = {
  id: "browser-review",
  sessionFile: "/review/browser-review.jsonl",
  scopeType: "project",
  scopePath: "/review",
  scopeLabel: "Browser review",
  title: "新对话",
  titleState: "temporary",
  createdAt: now,
  updatedAt: now,
  lastOpenedAt: now,
};

const assistant = mountAssistant(root, {
  send: async () => "browser-review-request",
  createConversation: async () => conversation,
  openConversation: async (value) => value,
  listConversations: async () => [],
  getLastConversation: async () => null,
  updateTitle: async (_id, title, titleState) => ({ ...conversation, title, titleState }),
  subscribe: () => () => {},
  cancel: () => {},
  listSkills: async () => [],
  listFiles: async () => [],
});

assistant.setScope({
  scopeType: "project",
  scopePath: "/review",
  scopeLabel: "Browser review",
  cwd: "/review",
});

document.body.dataset.reviewReady = "true";
