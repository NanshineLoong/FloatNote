import { AgentRunner, type AgentConfig } from "./agent.js";
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
  if (!provider || !model) return undefined;
  return { provider, model, apiKey: envApiKey(provider) };
}

async function main(): Promise<void> {
  const send = (msg: SidecarToHost) => {
    process.stdout.write(encodeLine(msg));
  };
  const runner = new AgentRunner({ send });

  const handle = async (msg: HostToSidecar): Promise<void> => {
    switch (msg.type) {
      case "configure":
        await runner.configure({ provider: msg.provider, model: msg.model, apiKey: msg.apiKey });
        break;
      case "prompt":
        try {
          await runner.prompt(msg);
        } catch (err) {
          send({ type: "error", requestId: msg.requestId, message: errorMessage(err) });
          send({ type: "done", requestId: msg.requestId });
        }
        break;
      case "apply_write_result":
        runner.onApplyWriteResult(msg);
        break;
      case "cancel":
        await runner.cancel();
        break;
    }
  };

  // Serialize host messages so a prompt finishes before the next is handled.
  let queue: Promise<void> = Promise.resolve();
  const decode = createLineDecoder();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    let messages: HostToSidecar[];
    try {
      messages = decode(chunk);
    } catch (err) {
      send({ type: "error", requestId: null, message: `bad protocol line: ${errorMessage(err)}` });
      return;
    }
    for (const msg of messages) {
      queue = queue.then(() =>
        handle(msg).catch((err) => {
          const requestId = "requestId" in msg ? (msg.requestId ?? null) : null;
          send({ type: "error", requestId, message: errorMessage(err) });
        }),
      );
    }
  });

  const initial = envConfig();
  if (initial) {
    try {
      await runner.configure(initial);
    } catch (err) {
      send({ type: "error", requestId: null, message: errorMessage(err) });
    }
  }

  send({ type: "ready" });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  process.stdout.write(encodeLine({ type: "error", requestId: null, message: errorMessage(err) }));
  process.exit(1);
});
