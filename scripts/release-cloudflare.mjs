import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const packageJsonPath = join(rootDir, "package.json");
const rawArgs = process.argv.slice(2);

function parseArgs(argv) {
  const options = {
    version: null,
    passThroughArgs: [],
    bossArgs: [],
  };

  for (const arg of argv) {
    options.passThroughArgs.push(arg);
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length).trim();
      continue;
    }
    if (arg === "--delete-remote-branch" || arg === "--keep-transport-release") {
      options.bossArgs.push(arg);
      continue;
    }
    if (arg === "--help") {
      options.bossArgs.push(arg);
    }
  }

  return options;
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

async function readCurrentVersion() {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return pkg.version;
}

async function main() {
  const options = parseArgs(rawArgs);

  if (rawArgs.includes("--help")) {
    console.log("Public release + Boss release wrapper.");
    console.log("Runs scripts/release-public-cloudflare.mjs, then scripts/release-boss.mjs using the final package version.");
    console.log("");
    process.exit(0);
  }

  await run("node", ["scripts/release-public-cloudflare.mjs", ...options.passThroughArgs]);

  const releasedVersion = options.version ?? await readCurrentVersion();
  await run("node", [
    "scripts/release-boss.mjs",
    `--version=${releasedVersion}`,
    ...options.bossArgs,
  ]);
}

await main();
