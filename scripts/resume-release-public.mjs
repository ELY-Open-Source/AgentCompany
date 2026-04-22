import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareR2ReleaseHost, uploadReleaseFiles } from "./release-local/r2.mjs";
import { loadEnvFile } from "./release/lib/dotenv.mjs";
import { createRunner } from "./release/lib/process.mjs";
import { createWorkflowHelpers } from "./release/lib/workflow.mjs";
import { applyD1Migrations } from "./release/lib/d1-migrations.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const landingDir = join(rootDir, "landing");
const localReleaseDir = join(rootDir, "local-release");
const pagesProjectName = "agentcompany";
const pagesBranch = "main";

const run = createRunner(rootDir);
const { getRepoInfo, cleanupRemoteTransportRelease } = createWorkflowHelpers(run);

function parseArgs(argv) {
  const options = { releaseTag: null, version: null };
  for (const arg of argv) {
    if (arg.startsWith("--release-tag=")) options.releaseTag = arg.slice("--release-tag=".length).trim();
    else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.releaseTag || !options.version) {
    throw new Error("Usage: node scripts/resume-release-public.mjs --release-tag=<tag> --version=<x.y.z>");
  }
  return options;
}

async function uploadWinAndLinuxToR2() {
  const r2 = await prepareR2ReleaseHost({ rootDir });
  await uploadReleaseFiles({ rootDir, releaseDir: join(localReleaseDir, "win"), bucket: r2.bucket, releasePrefix: r2.releasePrefix });
  await uploadReleaseFiles({ rootDir, releaseDir: join(localReleaseDir, "linux"), bucket: r2.bucket, releasePrefix: r2.releasePrefix });
}

async function applyLandingMigrations() {
  await applyD1Migrations({ landingDir, run });
}

async function buildAndDeployLanding() {
  if (!existsSync(join(landingDir, "node_modules"))) {
    await run("npm", ["ci"], { cwd: landingDir });
  }
  await run("npm", ["run", "build"], { cwd: landingDir });
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
  const releaseLinksSource = await readFile(join(landingDir, "components", "release-links.generated.ts"), "utf8");
  const requiredFragments = [
    `AgentCompany-${version}-arm64.dmg`,
    `AgentCompany.Setup.${version}.exe`,
    `agent-company-${version}.aarch64.rpm`,
    `agent-company_${version}_arm64.deb`,
  ];
  for (const fragment of requiredFragments) {
    if (!releaseLinksSource.includes(fragment)) {
      throw new Error(`Missing expected release asset in generated links: ${fragment}`);
    }
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

  const repo = await getRepoInfo();

  await uploadWinAndLinuxToR2();
  await run("node", ["scripts/generate-landing-release-links.mjs"]);
  await applyLandingMigrations();
  const deployUrl = await buildAndDeployLanding();
  await verifyPublishedAssets(options.version, deployUrl);
  await cleanupRemoteTransportRelease(repo, options.releaseTag);

  console.log(JSON.stringify({
    version: options.version,
    releaseTag: options.releaseTag,
    deployUrl,
    updateUrl: process.env.AGENTCOMPANY_UPDATE_URL ?? null,
  }, null, 2));
}

await main();
