import { describe, expect, test } from "vitest";
import { workloadBars } from "../../src/renderer/src/pages/home/workload-bars";
import type { AgentRecord, TaskRecord } from "../../src/shared/domain";

const agent = (id: string, name: string) => ({ id, name }) as AgentRecord;
const open = (assignee: string, count: number) => Array.from({ length: count }, () => ({ assigneeAgentId: assignee, status: "in_progress" }) as TaskRecord);

describe("team workload", () => {
  test("counts every agent: the busiest show, the rest are one labelled bar, and the total is everyone's", () => {
    const agents = Array.from({ length: 10 }, (_, index) => agent(`agt_${index}`, `Agent ${index}`));
    const tasks = agents.flatMap((item, index) => open(item.id, index));
    const { bars, total } = workloadBars(agents, tasks, 8);
    expect(total).toBe(45);
    expect(bars.map((bar) => [bar.label, bar.count])).toEqual([
      ["Agent", 9], ["Agent", 8], ["Agent", 7], ["Agent", 6], ["Agent", 5], ["Agent", 4], ["Agent", 3], ["3 others", 3],
    ]);
    expect(new Set(bars.map((bar) => bar.key)).size).toBe(8);
  });

  test("a small team shows everyone", () => {
    const { bars, total } = workloadBars([agent("a", "Ada Lovelace"), agent("b", "Ben")], [...open("a", 2)], 8);
    expect([bars.map((bar) => bar.label), total]).toEqual([["Ada", "Ben"], 2]);
  });
});
