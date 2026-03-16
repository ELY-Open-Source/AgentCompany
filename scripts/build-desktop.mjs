import { spawn } from "node:child_process";

const extraArgs = process.argv.slice(2);
const env = { ...process.env };

if (env.CSC_IDENTITY_AUTO_DISCOVERY === undefined) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

const allowedPublishModes = new Set(["always", "never", "onTag", "onTagOrDraft"]);
const explicitPublishArg = extraArgs.some((arg) => arg === "--publish" || arg.startsWith("--publish="));
const requestedPublishMode = env.AGENTCOMPANY_ELECTRON_PUBLISH?.trim();
let publishMode = "never";

if (requestedPublishMode) {
  if (!allowedPublishModes.has(requestedPublishMode)) {
    console.warn(
      `[build-desktop] Ignoring invalid AGENTCOMPANY_ELECTRON_PUBLISH="${requestedPublishMode}". ` +
        "Falling back to --publish never.",
    );
  } else {
    publishMode = requestedPublishMode;
  }
}

const builderArgs = ["exec", "electron-builder", "--config", "electron-builder.yml"];
if (!explicitPublishArg) {
  builderArgs.push("--publish", publishMode);
}
builderArgs.push(...extraArgs);

const child = spawn(
  "pnpm",
  builderArgs,
  {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  },
);

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
