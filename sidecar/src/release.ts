import { join } from "node:path";

export const SIDECAR_BUNDLE_FILE = "floatnote-agent.mjs";
export const SIDECAR_BINARY_NAME = "floatnote-agent";
export const NODE_RUNTIME_BINARY_NAME = "floatnote-node";

export function bundleOutputPath(sidecarRoot: string): string {
  return join(sidecarRoot, "dist", SIDECAR_BUNDLE_FILE);
}

export function targetBinaryPath(repoRoot: string, targetTriple: string, platform: NodeJS.Platform): string {
  const extension = platform === "win32" ? ".exe" : "";
  return join(repoRoot, "src-tauri", "binaries", `${SIDECAR_BINARY_NAME}-${targetTriple}${extension}`);
}

export function tauriResourceBundlePath(repoRoot: string): string {
  return join(repoRoot, "src-tauri", "resources", "sidecar", SIDECAR_BUNDLE_FILE);
}

export function targetRuntimePath(repoRoot: string, targetTriple: string, platform: NodeJS.Platform): string {
  const extension = platform === "win32" ? ".exe" : "";
  return join(repoRoot, "src-tauri", "binaries", `${NODE_RUNTIME_BINARY_NAME}-${targetTriple}${extension}`);
}
