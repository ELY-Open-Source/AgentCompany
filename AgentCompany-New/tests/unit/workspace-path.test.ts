import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveWorkspacePath } from "../../src/main/services/files/workspace-path";

describe("resolveWorkspacePath", () => {
  const root = join(tmpdir(), "ac-workspace-root");

  test("keeps a normal relative path inside the workspace", () => {
    const { absolute, relativePosix } = resolveWorkspacePath(root, "plan/business-plan.md");
    expect(relativePosix).toBe("plan/business-plan.md");
    expect(absolute.startsWith(resolve(root))).toBe(true);
  });

  test("rejects paths that escape the workspace via traversal", () => {
    expect(() => resolveWorkspacePath(root, "../../etc/passwd")).toThrow("escapes the workspace root");
    expect(() => resolveWorkspacePath(root, "plan/../../../secret.key")).toThrow("escapes the workspace root");
  });

  test("normalises a leading slash and refuses real drive-absolute paths", () => {
    // A leading slash is treated as workspace-relative, not a filesystem root.
    expect(resolveWorkspacePath(root, "/notes.md").relativePosix).toBe("notes.md");
    if (process.platform === "win32") {
      expect(() => resolveWorkspacePath(root, "C:\\Windows\\System32")).toThrow("must be relative");
    }
  });

  test("rejects an empty path", () => {
    expect(() => resolveWorkspacePath(root, "   ")).toThrow("required");
  });
});
