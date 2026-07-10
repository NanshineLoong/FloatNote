import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [resolve(sidecarRoot, "dist/floatnote-agent.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
const timer = setTimeout(() => finish(new Error("sidecar did not report ready within 5 seconds")), 5_000);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  if (stdout.split("\n").some((line) => line.includes('"type":"ready"'))) finish();
});
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.on("error", finish);
child.on("exit", (code) => {
  if (code !== 0 && !stdout.includes('"type":"ready"')) finish(new Error(stderr || `sidecar exited with ${code}`));
});

function finish(error) {
  clearTimeout(timer);
  if (!child.killed) child.kill();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
