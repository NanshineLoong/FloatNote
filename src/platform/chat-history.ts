import { invoke } from "@tauri-apps/api/core";

export type ChatScopeType = "project" | "document";
export type ChatTitleState = "final" | "temporary" | "generated" | "manual";

export interface ChatScope {
  scopeType: ChatScopeType;
  scopePath: string;
  scopeLabel: string;
  cwd: string;
}

export interface ChatConversation {
  id: string;
  sessionFile: string;
  scopeType: ChatScopeType;
  scopePath: string;
  scopeLabel: string;
  title: string;
  titleState: ChatTitleState;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export function chatGetForScope(scope: ChatScope): Promise<ChatConversation | null> {
  return invoke<ChatConversation | null>("chat_get_for_scope", { scopeType: scope.scopeType, scopePath: scope.scopePath });
}

export function chatCreate(scope: ChatScope): Promise<ChatConversation> {
  return invoke<ChatConversation>("chat_create", { scopeType: scope.scopeType, scopePath: scope.scopePath, scopeLabel: scope.scopeLabel });
}

export function chatListForScope(scope: ChatScope): Promise<ChatConversation[]> {
  return invoke<ChatConversation[]>("chat_list_for_scope", { scopeType: scope.scopeType, scopePath: scope.scopePath });
}

export function chatListAll(cursor: number, limit: number): Promise<ChatConversation[]> {
  return invoke<ChatConversation[]>("chat_list_all", { cursor, limit });
}

export function chatOpen(conversationId: string): Promise<ChatConversation | null> {
  return invoke<ChatConversation | null>("chat_open", { conversationId });
}

export function chatUpdateTitle(conversationId: string, title: string, titleState: ChatTitleState): Promise<ChatConversation | null> {
  return invoke<ChatConversation | null>("chat_update_title", { conversationId, title, titleState });
}

export function chatDelete(conversationId: string): Promise<ChatConversation | null> {
  return invoke<ChatConversation | null>("chat_delete", { conversationId });
}

export function chatClearBefore(timestamp: number): Promise<number> {
  return invoke<number>("chat_clear_before", { timestamp });
}

export function chatClearBeforeEntries(timestamp: number): Promise<ChatConversation[]> {
  return invoke<ChatConversation[]>("chat_clear_before_entries", { timestamp });
}

export function sessionDirFromFile(sessionFile: string): string {
  const slash = Math.max(sessionFile.lastIndexOf("/"), sessionFile.lastIndexOf("\\"));
  return slash >= 0 ? sessionFile.slice(0, slash) : ".";
}
