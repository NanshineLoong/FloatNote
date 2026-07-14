// Thin re-export entry. The agent surface is split across:
//   - model.ts            (AgentConfig, buildAgentModel)
//   - event-translate.ts  (translateEvent)
//   - runner.ts           (AgentRunner, defaultCreateSession, displayMessagesFromSession)
// Re-exports are limited to the symbols actually imported by main.ts and
// agent.test.ts. Runner-internal types (SessionFactory, AgentRunnerOptions,
// PromptRequest, NewSessionRequest, OpenSessionRequest, displayMessagesFromSession)
// stay exported from runner.ts for direct importers but are not re-exported
// here since no current consumer reaches them through this barrel.
export { buildAgentModel, type AgentConfig } from "./model.js";
export { translateEvent } from "./event-translate.js";
export { AgentRunner, rewindSessionToUserTurn, type SessionLike } from "./runner.js";
