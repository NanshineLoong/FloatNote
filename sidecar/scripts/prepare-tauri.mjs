import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(sidecarRoot, "..");
const targetTriple = process.env.FLOATNOTE_TARGET_TRIPLE
  ?? execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const runtime = process.env.FLOATNOTE_NODE_RUNTIME ?? process.execPath;
const extension = process.platform === "win32" ? ".exe" : "";
const resource = resolve(repoRoot, "src-tauri/resources/sidecar/floatnote-agent.mjs");
const binary = resolve(repoRoot, "src-tauri/binaries", `floatnote-node-${targetTriple}${extension}`);

if (!existsSync(runtime)) throw new Error(`Node runtime not found: ${runtime}`);
mkdirSync(dirname(resource), { recursive: true });
mkdirSync(dirname(binary), { recursive: true });
copyFileSync(resolve(sidecarRoot, "dist/floatnote-agent.mjs"), resource);
copyFileSync(runtime, binary);
// Tauri re-signs external binaries inside the finished macOS app bundle, so
// remove the copied runtime's local symbols before that final signing step.
if (process.platform === "darwin") execFileSync("strip", ["-S", "-x", binary]);
if (process.platform !== "win32") chmodSync(binary, 0o755);
