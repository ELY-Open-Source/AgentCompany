import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { combineMidRunPolls, createGoalChangePoller } from "../../src/main/services/goal-change-poller";

describe("goal change poller", () => {
  test("reports a closure and a rewrite once each, against the state seen when the run began", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("create table goals(id text primary key, title text, description text, status text); insert into goals values ('g1', 'Ship', 'MVP', 'active');");
    const poll = createGoalChangePoller(db, "g1");
    expect(poll()).toBeNull();
    db.exec("update goals set status = 'achieved' where id = 'g1'");
    expect(poll()).toBe('The goal for this work ("Ship") is now achieved. Stop starting new work on it: wrap up, report what you finished, and set this task\'s status.');
    expect(poll()).toBeNull();
    db.exec("update goals set description = 'Paid beta' where id = 'g1'");
    expect(poll()).toContain("It now reads: \"Ship\" — Paid beta");
    expect(createGoalChangePoller(db, null)()).toBeNull();
    expect(combineMidRunPolls(() => "a", () => null, () => "b")()).toBe("a\n\nb");
    db.close();
  });
});
