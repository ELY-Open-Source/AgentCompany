import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { prepareR2ReleaseHost } from "./release-local/r2.mjs";
import { loadEnvFile } from "./release/lib/dotenv.mjs";
import { applyD1Migrations } from "./release/lib/d1-migrations.mjs";
import { createRunner } from "./release/lib/process.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const landingDir = join(rootDir, "landing");
const packageJsonPath = join(rootDir, "package.json");
const pagesProjectName = "agentcompany";
const pagesBranch = "main";

const run = createRunner(rootDir);

function parseArgs(argv) {
  const options = { skipVerify: false };
  for (const arg of argv) {
    if (arg === "--skip-verify") {
      options.skipVerify = true;
      continue;
    }
    if (arg === "--help") {
      console.log(`Usage: node scripts/release-website.mjs [options]

Options:
  --skip-verify   Do not assert the deployed page includes the current version.
  --help          Show this help.
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

async function runPlain(command, args, cwd = rootDir) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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

async function buildAndDeployLanding() {
  if (!existsSync(join(landingDir, "node_modules"))) {
    await runPlain("npm", ["ci"], landingDir);
  }
  await runPlain("npm", ["run", "build"], landingDir);
  const deploy = await run(
    "npx",
    ["wrangler", "pages", "deploy", "out", "--project-name", pagesProjectName, "--branch", pagesBranch, "--commit-dirty=true"],
    { cwd: landingDir, capture: true },
  );
  const output = `${deploy.stdout}\n${deploy.stderr}`;
  const urlMatch = output.match(/https:\/\/[^\s]+\.agentcompany\.pages\.dev/);
  return urlMatch?.[0] ?? null;
}

async function verifyPublishedAssets(version, deployUrl) {
  const linksSource = await readFile(join(landingDir, "components", "release-links.generated.ts"), "utf8");
  const required = [
    `AgentCompany-${version}-arm64.dmg`,
    `AgentCompany.Setup.${version}.exe`,
    `agent-company-${version}.aarch64.rpm`,
    `agent-company_${version}_arm64.deb`,
  ];
  const missing = required.filter((frag) => !linksSource.includes(frag));
  if (missing.length > 0) {
    throw new Error(
      `Missing expected release assets in generated links (did you run release:local-mac and release:local-winlinux first?):\n  ${missing.join("\n  ")}`,
    );
  }
  if (deployUrl) {
    const { stdout } = await run("curl", ["-L", "--silent", "-A", "Mozilla/5.0", deployUrl], { capture: true });
    if (!stdout.includes(version)) {
      throw new Error(`Deployed landing preview ${deployUrl} does not contain version ${version}.`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvFile(join(rootDir, ".env.release.local"));
  await loadEnvFile(join(rootDir, ".env.release"));

  await prepareR2ReleaseHost({ rootDir });

  const version = (await readPackageJson()).version;
  console.log(`[release-website] regenerating landing for version ${version}`);

  await runPlain("node", ["scripts/generate-landing-release-links.mjs"]);
  await applyD1Migrations({ landingDir, run });
  const deployUrl = await buildAndDeployLanding();

  if (!options.skipVerify) {
    await verifyPublishedAssets(version, deployUrl);
  }

  console.log(JSON.stringify({
    version,
    deployUrl,
    updateUrl: process.env.AGENTCOMPANY_UPDATE_URL ?? null,
  }, null, 2));
}

await main();
