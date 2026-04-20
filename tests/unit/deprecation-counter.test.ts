import { beforeEach, describe, expect, it } from "vitest";
import {
  incrementDeprecationCall,
  readDeprecationCounters,
  resetDeprecationCounters,
} from "../../src/main/api-server/deprecation-counter";

/**
 * C4-followup #3: the in-process deprecation counter backs the
 * "has legacy traffic hit zero?" decision. Keep these tests tight —
 * the module has one job.
 */
describe("deprecation counter", () => {
  beforeEach(() => {
    resetDeprecationCounters();
  });

  it("increments and reads back the count for a single route", () => {
    incrementDeprecationCall("POST /legacy/hire");
    incrementDeprecationCall("POST /legacy/hire");
    expect(readDeprecationCounters()).toEqual({ "POST /legacy/hire": 2 });
  });

  it("tracks multiple route labels independently", () => {
    incrementDeprecationCall("POST /legacy/hire");
    incrementDeprecationCall("POST /legacy/approvals");
    incrementDeprecationCall("POST /legacy/hire");
    expect(readDeprecationCounters()).toEqual({
      "POST /legacy/hire": 2,
      "POST /legacy/approvals": 1,
    });
  });

  it("resets all counters back to empty", () => {
    incrementDeprecationCall("POST /legacy/hire");
    resetDeprecationCounters();
    expect(readDeprecationCounters()).toEqual({});
  });

  it("throws on an empty routeLabel instead of silently recording", () => {
    expect(() => incrementDeprecationCall("")).toThrow(/non-empty routeLabel/);
  });
});
