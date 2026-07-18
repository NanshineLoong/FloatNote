import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(sidecarRoot, "src/main.ts")],
  outfile: resolve(sidecarRoot, "dist/floatnote-agent.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  minify: true,
  sourcemap: false,
});
