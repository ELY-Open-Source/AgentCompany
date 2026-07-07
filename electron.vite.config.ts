import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The Composio integration key is compiled into the main-process bundle so
 * no credential file ever ships with the app. It lives in cred.txt at the
 * repository root (first line "Composio apikey: ak_..."), committed on
 * purpose — private repo, and every checkout must build a configured app.
 * A checkout without the file builds an app whose connector features report
 * the integration as unconfigured. Rotation = update cred.txt, rebuild.
 */
function composioApiKeyForBuild(): string {
  const credPath = resolve(__dirname, "cred.txt");
  if (!existsSync(credPath)) return "";
  const firstLine = readFileSync(credPath, "utf8").split("\n")[0] ?? "";
  return firstLine.split(":").slice(1).join(":").trim();
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __COMPOSIO_API_KEY__: JSON.stringify(composioApiKeyForBuild()),
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
        "@main": resolve(__dirname, "src/main"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
        "@preload": resolve(__dirname, "src/preload"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
        "@renderer": resolve(__dirname, "src/renderer"),
      },
    },
    plugins: [react()],
  },
});
