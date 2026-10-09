import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { loadViewState, saveViewState } from "../../src/main/services/view-state";

describe("view state", () => {
  test("keeps each key's latest value, including keys with dots and colons, and forgets on null", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-view-state-${randomUUID()}.db`));
    const db = connection.db;
    expect(loadViewState(db)).toEqual({});
    saveViewState(db, "route", "work");
    saveViewState(db, "org_1:work.view", "list");
    saveViewState(db, "org_1:work.scope", { kind: "goal", id: "gol_1" });
    saveViewState(db, "route", "settings");
    expect(loadViewState(db)).toEqual({ route: "settings", "org_1:work.view": "list", "org_1:work.scope": { kind: "goal", id: "gol_1" } });
    saveViewState(db, "org_1:work.scope", null);
    expect(loadViewState(db)).toEqual({ route: "settings", "org_1:work.view": "list" });
  });
});
