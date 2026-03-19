import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const bundledMainDependencies = [
  "@agentcompany/adapter-claude-local",
  "@agentcompany/adapter-codex-local",
  "@agentcompany/adapter-gemini-local",
  "@agentcompany/adapter-utils",
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledMainDependencies })],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@main": resolve("src/main"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          worker: resolve("src/main/orchestrator/worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["zod"] })],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@preload": resolve("src/preload"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
