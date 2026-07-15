import { AgentRunner, type AgentConfig } from "./agent.js";
import { createConfigurationGate } from "./configuration-gate.js";
import { sanitizeAgentError } from "./model.js";
import { createLineDecoder, encodeLine, type HostToSidecar, type SidecarToHost } from "./protocol.js";

/** Common env var name for a provider's API key. */
function envApiKey(provider: string): string | undefined {
  const direct = process.env[`${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`];
  if (direct) return direct;
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    default:
      return undefined;
  }
}

/** Initial config from env (PI_PROVIDER / PI_MODEL / <PROVIDER>_API_KEY). */
function envConfig(): AgentConfig | undefined {
  const provider = process.env.PI_PROVIDER;
  const model = process.env.PI_MODEL;
  if (!provider || !model || !isProviderId(provider)) return undefined;
  return { provider, model, apiKey: envApiKey(provider) };
}

function isProviderId(provider: string): provider is AgentConfig["provider"] {
  return ["openai", "deepseek", "anthropic", "bailian", "kimi", "zhipu"].includes(provider);
}

async function main(): Promise<void> {
  const send = (msg: SidecarToHost) => {
    process.stdout.write(encodeLine(msg));
  };
  const runner = new AgentRunner({ send });
  const configurationGate = createConfigurationGate();
  let configuredSecrets: string[] = [];
  const safeError = (error: unknown, extraSecrets: string[] = []) =>
    sanitizeAgentError(error, [...configuredSecrets, ...extraSecrets]);

  const handle = async (msg: HostToSidecar): Promise<void> => {
    switch (msg.type) {
      case "one_shot":
        try {
          await configurationGate.wait();
          send({ type: "one_shot_result", callId: msg.callId, result: await runner.oneShot(msg.task, msg.input) });
        } catch (err) {
          send({ type: "one_shot_result", callId: msg.callId, error: safeError(err) });
        }
        break;
      case "discard_session":
        runner.discardSession(msg.conversationId);
        break;
      case "configure":
        try {
          await configurationGate.run(() => runner.configure({
            provider: msg.provider,
            model: msg.model,
            apiKey: msg.apiKey,
            baseUrl: msg.baseUrl,
          }));
          configuredSecrets = msg.apiKey ? [msg.apiKey] : [];
          send({ type: "configure_result", callId: msg.callId, ok: true });
        } catch (err) {
          send({
            type: "configure_result",
            callId: msg.callId,
            ok: false,
            error: `${providerLabel(msg.provider)} / ${msg.model} 配置失败：${safeError(err, msg.apiKey ? [msg.apiKey] : [])}`,
          });
        }
        break;
      case "clear_configuration":
        try {
          await configurationGate.run(() => runner.clearConfiguration());
          configuredSecrets = [];
          send({ type: "configure_result", callId: msg.callId, ok: true });
        } catch (err) {
          send({ type: "configure_result", callId: msg.callId, ok: false, error: safeError(err) });
        }
        break;
      case "configuration_ready":
        await configurationGate.initialize();
        break;
      case "new_session":
        try {
          await configurationGate.wait();
          await runner.newSession(msg);
          send({ type: "new_session_result", callId: msg.callId, ok: true });
        } catch (err) {
          send({ type: "new_session_result", callId: msg.callId, ok: false, error: safeError(err) });
        }
        break;
      case "open_session":
        await configurationGate.wait();
        await runner.openSession(msg);
        break;
      case "prompt":
        try {
          await runner.prompt(msg);
        } catch (err) {
          send({ type: "error", requestId: msg.requestId, conversationId: msg.conversationId, message: safeError(err) });
          send({ type: "done", requestId: msg.requestId, conversationId: msg.conversationId, outcome: "failed" });
        }
        break;
      case "rewind":
        try {
          runner.rewind(msg.conversationId, msg.userEntryId);
          send({ type: "rewind_result", callId: msg.callId, ok: true });
        } catch (err) {
          send({ type: "rewind_result", callId: msg.callId, ok: false, error: safeError(err) });
        }
        break;
      case "apply_edit_result":
        runner.onApplyEditResult(msg);
        break;
      case "note_text":
        runner.onNoteText(msg);
        break;
      case "notes_list":
        runner.onNotesList(msg);
        break;
      case "create_note_result":
        runner.onCreateNoteResult(msg);
        break;
      case "list_skills":
        send({ type: "skills_list", callId: msg.callId, skills: runner.listSkills() });
        break;
      case "set_skill_paths":
        await runner.setSkillPaths(msg.skillPaths, msg.disabledSkillNames);
        break;
      case "cancel":
        await runner.cancel(msg.requestId);
        break;
    }
  };

  const decode = createLineDecoder();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    let messages: HostToSidecar[];
    try {
      messages = decode(chunk);
    } catch (err) {
      send({ type: "error", requestId: null, message: `bad protocol line: ${safeError(err)}` });
      return;
    }
    for (const msg of messages) {
      void handle(msg).catch((err) => {
        const requestId = "requestId" in msg ? (msg.requestId ?? null) : null;
        const conversationId = "conversationId" in msg ? msg.conversationId : undefined;
        send({ type: "error", requestId, conversationId, message: safeError(err) });
      });
    }
  });

  const initial = envConfig();
  if (initial) {
    try {
      await configurationGate.initialize(() => runner.configure(initial));
    } catch (err) {
      send({ type: "error", requestId: null, message: safeError(err) });
    }
  }

  send({ type: "ready" });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function providerLabel(provider: AgentConfig["provider"]): string {
  return ({
    openai: "OpenAI API",
    deepseek: "DeepSeek API",
    anthropic: "Anthropic API",
    bailian: "阿里云百炼 API",
    kimi: "Kimi API",
    zhipu: "智谱 API",
  })[provider];
}


main().catch((err) => {
  process.stdout.write(encodeLine({ type: "error", requestId: null, message: errorMessage(err) }));
  process.exit(1);
});
