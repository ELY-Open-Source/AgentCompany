import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const databaseNamePattern = /^[A-Za-z0-9_-]+$/;
const migrationFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/;

function stripTomlComment(line) {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (char === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlString(value, key) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) {
    throw new Error(`wrangler.toml key "${key}" must be a quoted string.`);
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`wrangler.toml key "${key}" has invalid string syntax: ${detail}`);
  }
}

function parseAssignment(line) {
  const equals = line.indexOf("=");
  if (equals === -1) return null;
  const key = line.slice(0, equals).trim();
  const value = line.slice(equals + 1).trim();
  if (!key) return null;
  return { key, value };
}

export function validateD1DatabaseName(databaseName) {
  if (!databaseNamePattern.test(databaseName)) {
    throw new Error(
      `Invalid Cloudflare D1 database_name "${databaseName}". Use only letters, numbers, underscores, and hyphens.`,
    );
  }
  return databaseName;
}

export function validateD1MigrationFileName(fileName) {
  if (!migrationFilePattern.test(fileName)) {
    throw new Error(
      `Invalid D1 migration file name "${fileName}". Use a plain .sql file name with letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  return fileName;
}

export function parseD1DatabaseName(wranglerToml) {
  let inD1Database = false;
  for (const rawLine of wranglerToml.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[[")) {
      inD1Database = line === "[[d1_databases]]";
      continue;
    }
    if (line.startsWith("[")) {
      inD1Database = false;
      continue;
    }
    if (!inD1Database) continue;
    const assignment = parseAssignment(line);
    if (!assignment || assignment.key !== "database_name") continue;
    return validateD1DatabaseName(
      parseTomlString(assignment.value, assignment.key),
    );
  }
  throw new Error("landing/wrangler.toml does not define [[d1_databases]].database_name.");
}

export async function listD1MigrationFiles(migrationsDir) {
  return (await readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith(".sql"))
    .map(validateD1MigrationFileName)
    .sort();
}

export async function applyD1Migrations({ landingDir, run }) {
  const migrationsDir = join(landingDir, "migrations");
  if (!existsSync(migrationsDir)) {
    return { databaseName: null, applied: 0 };
  }

  const wranglerToml = await readFile(join(landingDir, "wrangler.toml"), "utf8");
  const databaseName = parseD1DatabaseName(wranglerToml);
  const migrationFiles = await listD1MigrationFiles(migrationsDir);

  for (const fileName of migrationFiles) {
    await run(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        databaseName,
        "--remote",
        "--file",
        `migrations/${fileName}`,
      ],
      { cwd: landingDir, input: "y\n" },
    );
  }

  return { databaseName, applied: migrationFiles.length };
}
