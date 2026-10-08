import { describe, expect, test } from "vitest";
import { orderByRelevance } from "../../src/main/services/relevance";

describe("relevance", () => {
  test("ranks by shared words, keeps order on ties, and matches Chinese by character pairs", () => {
    const skills = ["Growth Hacker: viral campaigns", "Backend Architect: scalable system design", "财务分析：预算与现金流"];
    expect(orderByRelevance(skills, (item) => item, "Design a scalable backend system")).toEqual([skills[1], skills[0], skills[2]]);
    expect(orderByRelevance(skills, (item) => item, "整理下季度的现金流预算")).toEqual([skills[2], skills[0], skills[1]]);
    expect(orderByRelevance(skills, (item) => item, "")).toEqual(skills);
  });
});
