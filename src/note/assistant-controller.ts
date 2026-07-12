import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { mountAssistant, type AssistantHandle } from "../assistant/assistant";
import {
  agentCancel,
  agentListSkills,
  agentNewSession,
  agentOpenSession,
  agentSend,
  onAgentEvent,
} from "./agent";
import {
  chatCreate,
  chatGetForScope,
  chatListForScope,
  chatOpen,
  chatUpdateTitle,
  sessionDirFromFile,
  type ChatConversation,
  type ChatScope,
} from "./chat-history";
import { type NoteEntry, type ProjectEntry, listNotes, resolveDocuments, resolveProjects } from "./notes-state";
import { NoteSession } from "./note-session";
import { parentDir } from "./recent-projects";

export function chatScopeForSession(session: NoteSession): ChatScope | null {
  if (session.mode === "document") {
    if (!session.currentDocument) return null;
    return {
      scopeType: "document",
      scopePath: session.currentDocument.path,
      scopeLabel: session.currentDocument.name,
      cwd: parentDir(session.currentDocument.path),
    };
  }
  if (!session.currentProject) return null;
  return {
    scopeType: "project",
    scopePath: session.currentProject.path,
    scopeLabel: session.currentProject.name,
    cwd: session.currentProject.path,
  };
}

interface AssistantControllerDeps {
  region: HTMLElement;
  session: NoteSession;
  openProject: (project: ProjectEntry) => Promise<void>;
  openDocument: (document: NoteEntry) => Promise<void>;
  onChromeStateChange: (open: boolean) => void;
}

export interface AssistantController {
  handle: AssistantHandle;
  currentScope: () => ChatScope | null;
  toggleFromChrome: () => Promise<void>;
}

/** Owns the assistant panel, its agent session bridge, and history-open events. */
export function createAssistantController(deps: AssistantControllerDeps): AssistantController {
  const currentScope = () => chatScopeForSession(deps.session);
  const handle = mountAssistant(deps.region, {
    send: (payload, conversationId) => agentSend({ conversationId, ...payload }),
    createConversation: async (scope) => {
      const conversation = await chatCreate(scope);
      await agentNewSession({
        conversationId: conversation.id,
        cwd: scope.cwd,
        sessionDir: sessionDirFromFile(conversation.sessionFile),
      });
      return conversation;
    },
    openConversation: async (conversation) => {
      const opened = await chatOpen(conversation.id);
      if (!opened) return null;
      await agentOpenSession({ conversationId: opened.id, sessionFile: opened.sessionFile });
      return opened;
    },
    listConversations: chatListForScope,
    getLastConversation: chatGetForScope,
    updateTitle: chatUpdateTitle,
    subscribe: onAgentEvent,
    cancel: (requestId) => { void agentCancel(requestId); },
    listSkills: agentListSkills,
    listFiles: async (scope) => {
      if (scope.scopeType === "project") {
        const notes = await listNotes(scope.scopePath);
        return notes.map((note) => ({
          name: note.name,
          kind: note.name === "_inbox" ? "inbox" : note.name === "_tasks" ? "tasks" : "piece",
        }));
      }
      return [{ name: deps.session.currentDocument?.name ?? scope.scopeLabel, kind: "doc" as const }];
    },
  });

  let navigationToken = 0;

  async function openConversationFromHistory(conversation: ChatConversation) {
    const token = ++navigationToken;
    const window = getCurrentWindow();
    await window.show();
    await window.setFocus();
    if (conversation.scopeType === "project") {
      const [project] = await resolveProjects([conversation.scopePath]);
      if (!project) {
        handle.showError("这个项目已不可用，可在对话历史中删除该记录。");
        return;
      }
      await deps.openProject(project);
      if (token !== navigationToken) return;
    } else {
      const [document] = await resolveDocuments([conversation.scopePath]);
      if (!document) {
        handle.showError("这个文档已不可用，可在对话历史中删除该记录。");
        return;
      }
      await deps.openDocument(document);
      if (token !== navigationToken) return;
    }
    await handle.openConversation(conversation);
    if (token === navigationToken) await emit("chat://active", conversation.id);
  }

  void listen<string>("chat://open-id", async (event) => {
    const conversation = await chatOpen(event.payload);
    if (conversation) await openConversationFromHistory(conversation);
  });
  void listen<string>("chat://deleted", () => {
    navigationToken += 1;
    handle.setScope(currentScope());
  });

  async function toggleFromChrome() {
    const next = await invoke<{ open: boolean }>("toggle_assistant");
    deps.onChromeStateChange(next.open);
    handle.setInputOpen(next.open);
  }

  return { handle, currentScope, toggleFromChrome };
}
