import { describe, expect, it } from "vitest";
import {
  CONSOLE_ERROR_SUPPRESSION_RULES,
  WARNING_SUPPRESSION_RULES,
  classifyConsoleErrorSuppression,
  classifyWarningSuppression,
} from "../../src/main/main-warning-suppression-rules";

describe("main warning suppression rules", () => {
  it("documents every warning suppression category with an operator reason", () => {
    for (const rule of [...WARNING_SUPPRESSION_RULES, ...CONSOLE_ERROR_SUPPRESSION_RULES]) {
      expect(rule.category).toMatch(/^[a-z0-9-]+$/);
      expect(rule.reason.length).toBeGreaterThan(40);
    }
  });

  it("suppresses only the node sqlite experimental warning", () => {
    const sqliteWarning = new Error("SQLite is an experimental feature and might change at any time");
    sqliteWarning.name = "ExperimentalWarning";

    const genericWarning = new Error("fetch is an experimental feature");
    genericWarning.name = "ExperimentalWarning";

    expect(classifyWarningSuppression(sqliteWarning)).toBe("node-sqlite-experimental-warning");
    expect(classifyWarningSuppression("SQLite is an experimental feature and might change at any time"))
      .toBe("node-sqlite-experimental-warning");
    expect(classifyWarningSuppression(genericWarning)).toBeNull();
    expect(classifyWarningSuppression("deprecation warning")).toBeNull();
  });

  it("suppresses only disposed renderer frame send noise", () => {
    expect(classifyConsoleErrorSuppression([
      "Error sending from webFrameMain:",
      new Error("Render frame was disposed before WebFrameMain could send"),
    ])).toBe("electron-disposed-web-frame-send");

    expect(classifyConsoleErrorSuppression([
      "Error sending from webFrameMain:",
      new Error("Permission denied"),
    ])).toBeNull();
    expect(classifyConsoleErrorSuppression(["Unhandled renderer error", new Error("Render frame was disposed")]))
      .toBeNull();
  });
});
