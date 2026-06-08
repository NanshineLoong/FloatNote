import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});

