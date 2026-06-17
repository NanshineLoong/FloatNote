import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1422, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        assistant: resolve(__dirname, "assistant.html"),
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});

