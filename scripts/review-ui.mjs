import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW_URL = "http://127.0.0.1:1422/tests/review/browser/assistant.html";
const START_TIMEOUT_MS = 60_000;

export function withLoopbackNoProxy(env) {
  const next = { ...env };
  const entries = new Set(
    (env.NO_PROXY ?? env.no_proxy ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  entries.add("127.0.0.1");
  entries.add("localhost");
  const value = [...entries].join(",");
  next.NO_PROXY = value;
  next.no_proxy = value;
  return next;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForReviewUrl({
  url = REVIEW_URL,
  timeoutMs = START_TIMEOUT_MS,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() < deadline) await sleepImpl(250);
  } while (Date.now() < deadline);
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`review fixture did not become ready within ${timeoutMs}ms: ${detail}`);
}

async function isReviewServerReady() {
  try {
    await waitForReviewUrl({ timeoutMs: 500 });
    return true;
  } catch {
    return false;
  }
}

async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function runBrowserReview() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const env = withLoopbackNoProxy(process.env);
  let vite = null;

  try {
    if (!(await isReviewServerReady())) {
      process.stdout.write("[review-ui] starting Vite on 127.0.0.1:1422\n");
      vite = spawn(command, ["run", "dev", "--", "--host", "127.0.0.1"], {
        cwd: ROOT_DIR,
        detached: process.platform !== "win32",
        env,
        stdio: "inherit",
      });
      const earlyExit = new Promise((_, reject) => {
        vite.once("error", reject);
        vite.once("exit", (code, signal) => {
          reject(new Error(`Vite exited before review started (code=${code}, signal=${signal})`));
        });
      });
      await Promise.race([waitForReviewUrl({}), earlyExit]);
    } else {
      process.stdout.write("[review-ui] reusing Vite on 127.0.0.1:1422\n");
    }

    const result = await run(command, ["exec", "--", "wdio", "run", "./wdio.browser.conf.ts"], {
      cwd: ROOT_DIR,
      env,
      stdio: "inherit",
    });
    if (result.code !== 0) {
      throw new Error(`WebdriverIO failed (code=${result.code}, signal=${result.signal})`);
    }
  } finally {
    await stopProcessTree(vite);
  }
}

async function main() {
  try {
    await runBrowserReview();
  } catch (error) {
    process.stderr.write(`[review-ui] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
