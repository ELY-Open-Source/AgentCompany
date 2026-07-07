import { describe, expect, test } from "vitest";
import { OfficeSimulation, cameraFor, type MoveInput } from "../../src/renderer/src/pages/office/simulation";
import type { OfficeAgentInput } from "../../src/renderer/src/pages/office/office-types";

const IDLE: MoveInput = { up: false, down: false, left: false, right: false };

function agentInput(id: string, roleLevel = "staff"): OfficeAgentInput {
  return {
    id,
    name: `Agent ${id}`,
    role: "Engineer",
    title: "Engineer",
    department: "Engineering",
    roleLevel,
    activity: "idle",
    taskTitle: null,
  };
}

function steps(sim: OfficeSimulation, ms: number, input: Partial<MoveInput>): void {
  const move = { ...IDLE, ...input };
  for (let i = 0; i < ms / 16; i++) sim.step(16, move);
}

describe("office simulation", () => {
  test("the CEO takes the CEO office and staff fill open desks in order", () => {
    const sim = new OfficeSimulation();
    sim.sync([agentInput("a"), agentInput("ceo", "c_suite"), agentInput("b")]);
    const ceo = sim.agents.find((agent) => agent.input.id === "ceo")!;
    const staffA = sim.agents.find((agent) => agent.input.id === "a")!;
    const staffB = sim.agents.find((agent) => agent.input.id === "b")!;
    expect(ceo.isCeo).toBe(true);
    expect(ceo.seat).toEqual(sim.plan.ceoSeat);
    expect(staffA.deskIndex).toBe(0);
    expect(staffB.deskIndex).toBe(1);
  });

  test("positions survive snapshot refreshes without teleporting", () => {
    const sim = new OfficeSimulation();
    sim.sync([agentInput("a")]);
    sim.agents[0].x = 500;
    sim.agents[0].y = 320;
    sim.sync([agentInput("a")]);
    expect(sim.agents[0].x).toBe(500);
    expect(sim.agents[0].y).toBe(320);
  });

  test("the board member spawns at the entrance and keeps position on re-sync", () => {
    const sim = new OfficeSimulation();
    sim.syncPlayer("emp-1", "Dana Lee");
    expect(sim.player!.x).toBe(sim.plan.entrance.x);
    expect(sim.player!.y).toBe(sim.plan.entrance.y);
    steps(sim, 600, { right: true });
    const movedX = sim.player!.x;
    sim.syncPlayer("emp-1", "Dana Lee");
    expect(sim.player!.x).toBe(movedX);
  });

  test("WASD input moves and faces the board member", () => {
    const sim = new OfficeSimulation();
    sim.syncPlayer("emp-1", "Dana Lee");
    const startX = sim.player!.x;
    steps(sim, 320, { right: true });
    expect(sim.player!.x).toBeGreaterThan(startX + 30);
    expect(sim.player!.facing).toBe("east");
    expect(sim.player!.walkPhase).toBeGreaterThan(0);
    sim.step(16, IDLE);
    expect(sim.player!.walkPhase).toBe(0);
  });

  test("walls stop the board member", () => {
    const sim = new OfficeSimulation();
    sim.syncPlayer("emp-1", "Dana Lee");
    steps(sim, 4000, { left: true });
    expect(sim.player!.x).toBeGreaterThanOrEqual(22);
    const y = sim.player!.y;
    steps(sim, 4000, { up: true });
    expect(sim.player!.y).toBeGreaterThan(288);
    expect(sim.player!.y).toBeLessThanOrEqual(y);
  });

  test("diagonal movement is not faster than straight movement", () => {
    const sim = new OfficeSimulation();
    sim.syncPlayer("emp-1", "Dana Lee");
    const start = { x: sim.player!.x, y: sim.player!.y };
    steps(sim, 160, { right: true, down: true });
    const diagonal = Math.hypot(sim.player!.x - start.x, sim.player!.y - start.y);
    const sim2 = new OfficeSimulation();
    sim2.syncPlayer("emp-2", "Alex");
    const start2 = sim2.player!.x;
    steps(sim2, 160, { right: true });
    const straight = sim2.player!.x - start2;
    expect(diagonal).toBeLessThanOrEqual(straight + 0.5);
    expect(diagonal).toBeGreaterThan(straight * 0.7);
  });

  test("camera follows the player and clamps at world edges", () => {
    const sim = new OfficeSimulation();
    sim.sync(Array.from({ length: 30 }, (_, i) => agentInput(`a${i}`)));
    const world = sim.plan.world;
    const centered = cameraFor(world, 600, 400, { x: 700, y: 700 });
    expect(centered).toEqual({ x: 400, y: 500 });
    const topLeft = cameraFor(world, 600, 400, { x: 0, y: 0 });
    expect(topLeft).toEqual({ x: 0, y: 0 });
    const bottomRight = cameraFor(world, 600, 400, { x: world.w, y: world.h });
    expect(bottomRight).toEqual({ x: world.w - 600, y: world.h - 400 });
    const wide = cameraFor(world, world.w + 200, 400, { x: 0, y: 0 });
    expect(wide.x).toBe(-100);
  });
});
