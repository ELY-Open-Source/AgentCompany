import type { SkillManifest } from "./skill-manifest";

/** The provider and model a run talks to. */
export interface RunModel {
  providerKey: string;
  model: string | null;
}

/** True when a compatible_models pattern ("openai/*", "gpt-5.4") matches the run's model; no patterns means any model. */
export function modelCompatible(patterns: string[], run: RunModel): boolean {
  if (patterns.length === 0) return true;
  if (!run.model) return false;
  const names = [`${run.providerKey}/${run.model}`, run.model];
  return patterns.some((pattern) => {
    const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "i");
    return names.some((name) => regex.test(name));
  });
}

export function runModelLabel(run: RunModel): string {
  return run.model ? `${run.providerKey}/${run.model}` : `${run.providerKey} (no model set)`;
}

/** One skill's prompt section, its declared risk and contract first. */
export function skillPart(manifest: SkillManifest, version: string, body: string): string {
  const header = [`# Skill: ${manifest.name}`, `Version: ${version}`, `Risk: ${manifest.riskLevel}`];
  const inputs = declaration(manifest.inputs);
  const outputs = declaration(manifest.outputs);
  if (inputs) header.push(`Expects as input: ${inputs}`);
  if (outputs) header.push(`Must produce: ${outputs}`);
  return [header.join("\n"), body].join("\n\n");
}

function declaration(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null && Object.keys(value).length > 0) return JSON.stringify(value);
  return null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
