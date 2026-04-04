import { spawn } from "node:child_process";
import { resolve } from "node:path";

const vitestEntrypoint = resolve(process.cwd(), "node_modules/vitest/vitest.mjs");
const args = process.argv.slice(2);
const warningFlag = "--disable-warning=ExperimentalWarning";
const env = { ...process.env };
const existingNodeOptions = env.NODE_OPTIONS?.trim();

if (!existingNodeOptions) {
  env.NODE_OPTIONS = warningFlag;
} else if (!existingNodeOptions.includes(warningFlag)) {
  env.NODE_OPTIONS = `${existingNodeOptions} ${warningFlag}`;
}

const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", vitestEntrypoint, ...args], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
