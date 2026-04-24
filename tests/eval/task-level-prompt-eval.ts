import { createHash } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import {
  buildStableSystemPrompt,
  buildTaskPrompt,
  type PromptContext,
} from "../../src/main/prompt-builder/index";

const PROMPT_ENCODING = getEncoding("cl100k_base");

export interface TaskPromptEvalCase {
  caseId: string;
  taskLevel: "executive" | "manager" | "individual_contributor";
  description: string;
  context: PromptContext;
  requiredHeadings: string[];
  forbiddenHeadings: string[];
  requiredFragments?: string[];
  forbiddenFragments?: string[];
}

export interface PromptSectionMetric {
  heading: string;
  level: number;
  byteLength: number;
  tokenCount: number;
  inStablePrefix: boolean;
}

export interface TaskPromptEvalResult {
  caseId: string;
  passed: boolean;
  promptHash: string;
  totalTokens: number;
  stablePrefixTokens: number;
  volatileTailTokens: number;
  sections: PromptSectionMetric[];
  failures: string[];
}

function tokenCount(value: string): number {
  return PROMPT_ENCODING.encode(value).length;
}

function hashPrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

export function extractPromptSections(prompt: string, stablePrefixLength: number): PromptSectionMetric[] {
  const matches = Array.from(prompt.matchAll(/^(#{1,6})\s+(.+)$/gm));
  return matches.map((match, index) => {
    if (match.index === undefined || match[1] === undefined || match[2] === undefined) {
      throw new Error("task prompt eval: malformed markdown heading match");
    }
    const start = match.index;
    const next = matches[index + 1];
    const end = next?.index ?? prompt.length;
    const text = prompt.slice(start, end);
    return {
      heading: match[2].trim(),
      level: match[1].length,
      byteLength: Buffer.byteLength(text, "utf8"),
      tokenCount: tokenCount(text),
      inStablePrefix: start < stablePrefixLength,
    };
  });
}

export function evaluateTaskPromptCase(
  testCase: TaskPromptEvalCase,
  prompt: string,
  stablePrefix: string,
): TaskPromptEvalResult {
  const failures: string[] = [];
  if (!prompt.startsWith(stablePrefix)) {
    failures.push("full prompt does not begin with the stable system prefix");
  }

  const sections = extractPromptSections(prompt, stablePrefix.length);
  const headings = new Set(sections.map((section) => section.heading));

  for (const heading of testCase.requiredHeadings) {
    if (!headings.has(heading)) {
      failures.push(`missing required heading "${heading}"`);
    }
  }

  for (const heading of testCase.forbiddenHeadings) {
    if (headings.has(heading)) {
      failures.push(`forbidden heading "${heading}" is present`);
    }
  }

  for (const fragment of testCase.requiredFragments ?? []) {
    if (!prompt.includes(fragment)) {
      failures.push(`missing required fragment "${fragment}"`);
    }
  }

  for (const fragment of testCase.forbiddenFragments ?? []) {
    if (prompt.includes(fragment)) {
      failures.push(`forbidden fragment "${fragment}" is present`);
    }
  }

  const totalTokens = tokenCount(prompt);
  const stablePrefixTokens = tokenCount(stablePrefix);
  const volatileTailTokens = tokenCount(prompt.slice(stablePrefix.length));

  return {
    caseId: testCase.caseId,
    passed: failures.length === 0,
    promptHash: hashPrompt(prompt),
    totalTokens,
    stablePrefixTokens,
    volatileTailTokens,
    sections,
    failures,
  };
}

export function runTaskPromptEvalCase(testCase: TaskPromptEvalCase): TaskPromptEvalResult {
  return evaluateTaskPromptCase(
    testCase,
    buildTaskPrompt(testCase.context),
    buildStableSystemPrompt(testCase.context),
  );
}

export function collectRequiredHeadingUsage(cases: TaskPromptEvalCase[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const testCase of cases) {
    for (const heading of testCase.requiredHeadings) {
      const caseIds = usage.get(heading) ?? [];
      caseIds.push(testCase.caseId);
      usage.set(heading, caseIds);
    }
  }
  return usage;
}
