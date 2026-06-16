/**
 * Manual host harness — drives the sidecar over stdio without Tauri.
 *
 * Usage (needs a valid key):
 *   ANTHROPIC_API_KEY=sk-... npx tsx test/harness.ts
 *   PI_PROVIDER=anthropic PI_MODEL=claude-opus-4-5 npx tsx test/harness.ts
 *
 * It spawns the sidecar, sends one `configure` + one `prompt`, prints every
 * stdout line, auto-replies to `apply_write` with ok, and exits on `done`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLineDecoder, encodeLine, type HostToSidecar, type SidecarToHost } from "../src/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = resolve(__dirname, "../src/main.ts");

const provider = process.env.PI_PROVIDER ?? "anthropic";
const model = process.env.PI_MODEL ?? "claude-opus-4-5";
const apiKey =
  process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("[harness] no API key in env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY)");
  process.exit(1);
}

const NOTE = `# 光合作用笔记

光合作用是植物把阳光变成能量的过程。
发生在叶子里。需要二氧化碳和水。`;

const child = spawn("npx", ["tsx", mainPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

const send = (msg: HostToSidecar) => {
  child.stdin.write(encodeLine(msg));
};

const decode = createLineDecoder() as unknown as (chunk: string) => SidecarToHost[];

let promptSent = false;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  for (const msg of decode(chunk)) {
    console.log("[sidecar→host]", JSON.stringify(msg));
    switch (msg.type) {
      case "ready":
        if (!promptSent) {
          promptSent = true;
          send({ type: "configure", provider, model, apiKey });
          send({
            type: "prompt",
            requestId: "r1",
            noteId: "光合作用笔记",
            noteText: NOTE,
            userText: "帮我把这段整理成结构化的要点，然后用 write_note 改写我的笔记。",
          });
        }
        break;
      case "apply_write":
        console.log("[harness] auto-approving write, content:\n" + msg.content);
        send({ type: "apply_write_result", callId: msg.callId, ok: true, version: 1 });
        break;
      case "done":
        console.log("[harness] done — closing.");
        child.stdin.end();
        child.kill();
        process.exit(0);
        break;
      case "error":
        console.error("[harness] sidecar error:", msg.message);
        break;
    }
  }
});

child.on("exit", (code) => {
  console.log(`[harness] sidecar exited with code ${code}`);
});
