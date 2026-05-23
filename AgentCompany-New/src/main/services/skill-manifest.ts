import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RISK_LEVEL, type RiskLevel } from "../../shared/domain";
import { assertSafeSkillPath } from "./skill-artifacts";

export interface SkillManifest {
  name: string;
  version: string;
  entrypoint: string;
  capabilities: string[];
  requiredTools: string[];
  compatibleModels: string[];
  riskLevel: RiskLevel;
  tests: string[];
  inputs: unknown;
  outputs: unknown;
}

export function loadSkillManifest(directoryPath: string, requestedVersion: string): SkillManifest {
  const manifestPath = join(directoryPath, "skill.manifest.json");
  if (!existsSync(manifestPath)) throw new Error("skill.manifest.json is required.");
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const manifest = normalizeManifest(raw);
  if (manifest.version !== requestedVersion) {
    throw new Error("Skill manifest version must match the requested version.");
  }
  verifyDeclaredFile(directoryPath, manifest.entrypoint);
  for (const testPath of manifest.tests) verifyDeclaredFile(directoryPath, testPath);
  return manifest;
}

function normalizeManifest(raw: Record<string, unknown>): SkillManifest {
  const manifest: SkillManifest = {
    name: readString(raw.name, "name"),
    version: readSemver(raw.version),
    entrypoint: assertSafeSkillPath(readString(raw.entrypoint, "entrypoint")),
    capabilities: readStringArray(raw.capabilities, "capabilities"),
    requiredTools: readStringArray(raw.required_tools ?? raw.requiredTools, "required_tools"),
    compatibleModels: readStringArray(raw.compatible_models ?? raw.compatibleModels, "compatible_models"),
    riskLevel: readRisk(raw.risk_level ?? raw.riskLevel),
    tests: readStringArray(raw.tests, "tests").map(assertSafeSkillPath),
    inputs: raw.inputs ?? {},
    outputs: raw.outputs ?? {},
  };
  return manifest;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Skill manifest field ${field} is required.`);
  return value.trim();
}

function readSemver(value: unknown): string {
  const version = readString(value, "version");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Skill manifest version must be valid semver.");
  }
  return version;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Skill manifest field ${field} must be an array.`);
  return value.map((item) => readString(item, field));
}

function readRisk(value: unknown): RiskLevel {
  if (value === RISK_LEVEL.LOW || value === RISK_LEVEL.MEDIUM || value === RISK_LEVEL.HIGH) return value;
  throw new Error("Skill manifest risk_level must be low, medium, or high.");
}

function verifyDeclaredFile(directoryPath: string, relativePath: string): void {
  const path = join(directoryPath, ...relativePath.split("/"));
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Skill manifest file was not found: ${relativePath}`);
  }
}
