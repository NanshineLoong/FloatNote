// Thin re-export entry. The agent surface is split across:
//   - model.ts            (AgentConfig, buildAgentModel)
//   - event-translate.ts  (translateEvent)
//   - runner.ts           (AgentRunner, defaultCreateSession, displayMessagesFromSession)
// Public exports are preserved verbatim for existing importers
// (main.ts, agent.test.ts).

export { buildAgentModel, type AgentConfig } from "./model.js";
export { translateEvent } from "./event-translate.js";
export {
  AgentRunner,
  displayMessagesFromSession,
  type SessionLike,
  type SessionFactory,
  type AgentRunnerOptions,
  type PromptRequest,
  type NewSessionRequest,
  type OpenSessionRequest,
} from "./runner.js";
