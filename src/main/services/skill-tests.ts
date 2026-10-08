import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { normalize } from "node:path";

export interface SkillTestRow {
  id: string;
  test_type: string;
  expected_output_ref: string;
}

export interface SkillArtifactRow {
  artifact_type: string;
  object_key: string;
  sha256: string;
  size_bytes: number;
}

export interface SkillTestResult {
  status: "passed" | "failed";
  testType: string;
  expectedOutputRef: string;
  checks: Array<{ name: string; status: "passed" | "failed"; detail: string }>;
  artifactSha256?: string;
  failure?: string;
}

export function verifyRevisionStructure(artifacts: SkillArtifactRow[]): SkillTestResult | null {
  const requiredTypes = ["manifest", "entrypoint"];
  for (const type of requiredTypes) {
    if (!artifacts.some((artifact) => artifact.artifact_type === type)) {
      return failedSkillTest("revision_structure", type, `Skill revision artifact is missing: ${type}`);
    }
  }
  for (const artifact of artifacts) {
    try {
      verifyArtifactIntegrity(artifact);
    } catch (error) {
      return failedSkillTest("artifact_integrity", artifact.object_key, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

export function runManifestArtifactTest(test: SkillTestRow, artifacts: SkillArtifactRow[]): SkillTestResult {
  if (test.test_type !== "manifest") {
    return failedSkillTest(test.test_type, test.expected_output_ref, `Unsupported skill test type: ${test.test_type}`);
  }
  const testArtifact = artifacts.find((artifact) => (
    artifact.artifact_type === "test" && artifactMatchesExpectedRef(artifact.object_key, test.expected_output_ref)
  ));
  if (!testArtifact) return failedSkillTest(test.test_type, test.expected_output_ref, "Skill test artifact was not found.");

  try {
    const content = verifyArtifactIntegrity(testArtifact).toString("utf8");
    if (!content.trim()) throw new Error("Skill test artifact is empty.");
    return {
      status: "passed",
      testType: test.test_type,
      expectedOutputRef: test.expected_output_ref,
      artifactSha256: testArtifact.sha256,
      checks: [
        { name: "manifest_test_artifact", status: "passed", detail: "Artifact exists, checksum matches, and content is non-empty." },
      ],
    };
  } catch (error) {
    return failedSkillTest(test.test_type, test.expected_output_ref, error instanceof Error ? error.message : String(error));
  }
}

function verifyArtifactIntegrity(artifact: SkillArtifactRow): Buffer {
  if (!existsSync(artifact.object_key)) throw new Error(`Skill artifact is missing: ${artifact.object_key}`);
  const body = readFileSync(artifact.object_key);
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== artifact.sha256) throw new Error(`Skill artifact checksum mismatch: ${artifact.object_key}`);
  if (body.byteLength !== artifact.size_bytes) throw new Error(`Skill artifact size mismatch: ${artifact.object_key}`);
  return body;
}

function artifactMatchesExpectedRef(objectKey: string, expectedRef: string): boolean {
  const expected = normalizeSkillPath(expectedRef);
  const actual = normalizeSkillPath(objectKey);
  return actual === expected || actual.endsWith(`/${expected}`);
}

function normalizeSkillPath(value: string): string {
  return normalize(value).replaceAll("\\", "/");
}

function failedSkillTest(testType: string, expectedOutputRef: string, failure: string): SkillTestResult {
  return {
    status: "failed",
    testType,
    expectedOutputRef,
    checks: [{ name: "skill_test", status: "failed", detail: failure }],
    failure,
  };
}
