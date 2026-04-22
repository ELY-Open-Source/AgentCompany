import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface D1MigrationModule {
  applyD1Migrations(input: {
    landingDir: string;
    run: (
      command: string,
      args: string[],
      options: { cwd: string; input: string },
    ) => Promise<unknown>;
  }): Promise<{ databaseName: string | null; applied: number }>;
  parseD1DatabaseName(source: string): string;
  validateD1MigrationFileName(fileName: string): string;
}

const tempDirs: string[] = [];

async function loadModule(): Promise<D1MigrationModule> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "scripts/release/lib/d1-migrations.mjs"),
  ).href;
  return await import(moduleUrl) as D1MigrationModule;
}

async function createLandingFixture() {
  const landingDir = await mkdtemp(join(tmpdir(), "agentcompany-d1-test-"));
  tempDirs.push(landingDir);
  await mkdir(join(landingDir, "migrations"), { recursive: true });
  await writeFile(
    join(landingDir, "wrangler.toml"),
    [
      "name = \"agentcompany\"",
      "",
      "[[d1_databases]]",
      "binding = \"DOWNLOAD_COUNTER_DB\"",
      "database_name = \"agentcompany-landing-downloads\"",
      "database_id = \"dfa3f0f3-009b-4436-b519-5b50ae6b1cf9\"",
      "",
    ].join("\n"),
    "utf8",
  );
  return landingDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Cloudflare D1 migration release helper", () => {
  it("parses the D1 database name from the wrangler D1 table", async () => {
    const { parseD1DatabaseName } = await loadModule();

    expect(parseD1DatabaseName([
      "[vars]",
      "DOWNLOAD_COUNTER_SALT = \"salt\"",
      "",
      "[[d1_databases]]",
      "binding = \"DOWNLOAD_COUNTER_DB\"",
      "database_name = \"agentcompany-landing-downloads\" # production",
    ].join("\n"))).toBe("agentcompany-landing-downloads");
  });

  it("rejects shell-shaped database names", async () => {
    const { parseD1DatabaseName } = await loadModule();

    expect(() => parseD1DatabaseName([
      "[[d1_databases]]",
      "database_name = \"prod; rm -rf /\"",
    ].join("\n"))).toThrow("Invalid Cloudflare D1 database_name");
  });

  it("rejects path-shaped migration file names", async () => {
    const { validateD1MigrationFileName } = await loadModule();

    expect(() => validateD1MigrationFileName("../0001.sql")).toThrow(
      "Invalid D1 migration file name",
    );
    expect(() => validateD1MigrationFileName("0001;touch.sql")).toThrow(
      "Invalid D1 migration file name",
    );
  });

  it("executes wrangler through argv and confirms through stdin", async () => {
    const { applyD1Migrations } = await loadModule();
    const landingDir = await createLandingFixture();
    await writeFile(
      join(landingDir, "migrations", "0001_download_counter.sql"),
      "SELECT 1;",
      "utf8",
    );
    await writeFile(
      join(landingDir, "migrations", "notes.txt"),
      "ignored",
      "utf8",
    );
    const calls: Array<{
      command: string;
      args: string[];
      options: { cwd: string; input: string };
    }> = [];

    const result = await applyD1Migrations({
      landingDir,
      run: async (command, args, options) => {
        calls.push({ command, args, options });
        return {};
      },
    });

    expect(result).toEqual({
      databaseName: "agentcompany-landing-downloads",
      applied: 1,
    });
    expect(calls).toEqual([
      {
        command: "npx",
        args: [
          "wrangler",
          "d1",
          "execute",
          "agentcompany-landing-downloads",
          "--remote",
          "--file",
          "migrations/0001_download_counter.sql",
        ],
        options: { cwd: landingDir, input: "y\n" },
      },
    ]);
  });
});
