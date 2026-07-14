import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_PORT = 4445;
const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 400;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function positiveInteger(flag, value) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function parseDoctorOptions(argv) {
  const options = { port: DEFAULT_PORT, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--port") {
      options.port = positiveInteger(flag, argv[++index]);
    } else if (flag === "--timeout") {
      options.timeoutMs = positiveInteger(flag, argv[++index]);
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForWebDriverReady({
  port,
  timeoutMs,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    try {
      const remaining = Math.max(1, deadline - Date.now());
      const response = await fetchImpl(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(Math.min(2_000, remaining)),
      });
      const body = await response.text();
      if (!response.ok) {
        lastError = new Error(`GET /status failed (${response.status}): ${body}`);
      } else {
        const payload = JSON.parse(body);
        if (payload?.value?.ready === true) return payload;
        lastError = new Error(`GET /status returned not-ready: ${body}`);
      }
    } catch (error) {
      lastError = error;
    }
    if (Date.now() < deadline) await sleepImpl(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`WebDriver did not become ready on port ${port} within ${timeoutMs}ms: ${detail}`);
}

async function responseBody(response) {
  const text = await response.text();
  if (!response.ok) return { ok: false, text };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    throw new Error(`WebDriver returned invalid JSON (${response.status}): ${text}`);
  }
}

export async function createWebDriverSession({ port, fetchImpl = fetch }) {
  const endpoint = `http://127.0.0.1:${port}`;
  const payload = {
    capabilities: {
      alwaysMatch: {
        browserName: "tauri",
        "tauri:options": { windowLabel: "main" },
      },
      firstMatch: [{}],
    },
  };
  const response = await fetchImpl(`${endpoint}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await responseBody(response);
  if (!body.ok) {
    throw new Error(`POST /session failed (${response.status}): ${body.text}`);
  }
  const sessionId = body.value?.value?.sessionId ?? body.value?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error(`POST /session returned no session id: ${JSON.stringify(body.value)}`);
  }

  const deleted = await fetchImpl(`${endpoint}/session/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(10_000),
  });
  const deletedBody = await deleted.text();
  if (!deleted.ok) {
    throw new Error(`DELETE /session/${sessionId} failed (${deleted.status}): ${deletedBody}`);
  }
  return sessionId;
}

async function assertPortFree(port, purpose) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      reject(new Error(`${purpose} port ${port} is unavailable: ${error.message}`));
    });
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function tee(stream, file, terminal) {
  stream.on("data", (chunk) => {
    file.write(chunk);
    terminal.write(chunk);
  });
}

async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

export async function runDoctor(options) {
  await assertPortFree(options.port, "embedded WebDriver");
  await assertPortFree(1422, "Vite");

  const artifactDir = path.join(ROOT_DIR, "artifacts", "native-doctor", timestamp());
  await mkdir(artifactDir, { recursive: true });
  const stdoutFile = createWriteStream(path.join(artifactDir, "stdout.log"));
  const stderrFile = createWriteStream(path.join(artifactDir, "stderr.log"));
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const noProxy = new Set(
    (process.env.NO_PROXY ?? process.env.no_proxy ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  noProxy.add("127.0.0.1");
  noProxy.add("localhost");
  const noProxyValue = [...noProxy].join(",");
  const args = [
    "run", "tauri", "--", "dev",
    "--no-watch",
    "--features", "e2e-wdio",
    "--config", "src-tauri/tauri.review.conf.json",
  ];
  process.stdout.write(`[native-doctor] artifacts: ${artifactDir}\n`);
  process.stdout.write(`[native-doctor] starting: ${command} ${args.join(" ")}\n`);

  const child = spawn(command, args, {
    cwd: ROOT_DIR,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      RUST_BACKTRACE: process.env.RUST_BACKTRACE || "1",
      RUST_LOG: process.env.RUST_LOG || "info,tauri_plugin_wdio_webdriver=debug",
      TAURI_WEBDRIVER_PORT: String(options.port),
      VITE_WDIO: "1",
      NO_PROXY: noProxyValue,
      no_proxy: noProxyValue,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  tee(child.stdout, stdoutFile, process.stdout);
  tee(child.stderr, stderrFile, process.stderr);

  let exitState = null;
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exitState = { code, signal };
      resolve(exitState);
    });
  });
  const earlyExit = exitPromise.then(({ code, signal }) => {
    throw new Error(`Tauri dev exited before the probe completed (code=${code}, signal=${signal})`);
  });

  const shutdown = () => { void stopProcessTree(child); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await Promise.race([
      waitForWebDriverReady({ port: options.port, timeoutMs: options.timeoutMs }),
      earlyExit,
    ]);
    process.stdout.write(`[native-doctor] /status ready on ${options.port}\n`);
    const sessionId = await Promise.race([
      createWebDriverSession({ port: options.port }),
      earlyExit,
    ]);
    process.stdout.write(`[native-doctor] session probe passed: ${sessionId}\n`);
  } catch (error) {
    await Promise.race([exitPromise, sleep(300)]);
    const suffix = exitState
      ? ` process exit: code=${exitState.code}, signal=${exitState.signal}`
      : " process was still running when the probe failed";
    throw new Error(`${error instanceof Error ? error.message : String(error)};${suffix}; logs: ${artifactDir}`);
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    await stopProcessTree(child);
    stdoutFile.end();
    stderrFile.end();
  }
}

async function main() {
  try {
    await runDoctor(parseDoctorOptions(process.argv.slice(2)));
    process.stdout.write("[native-doctor] PASS\n");
  } catch (error) {
    process.stderr.write(`[native-doctor] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
