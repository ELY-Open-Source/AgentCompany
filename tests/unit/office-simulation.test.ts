import { describe, expect, test } from "vitest";
import { OfficeSimulation, cameraFor, type MoveInput } from "../../src/renderer/src/pages/office/simulation";
import type { OfficeAgentInput } from "../../src/renderer/src/pages/office/office-types";
import type { OfficeState } from "../../src/renderer/src/pages/office/agent-state";

const IDLE: MoveInput = { up: false, down: false, left: false, right: false };

function agentInput(id: string, roleLevel = "staff", state: OfficeState = "idle"): OfficeAgentInput {
  return {
    id,
    name: `Agent ${id}`,
    role: "Engineer",
    title: "Engineer",
    department: "Engineering",
    roleLevel,
    status: { state, hold: null },
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

  test("idle agents take a coffee break and carry the cup back to their desk", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a")]);
    const agent = sim.agents[0];
    const coffee = sim.plan.amenities.find((spot) => spot.kind === "coffee")!;

    let reachedCoffee = false;
    let backSeated = false;
    for (let i = 0; i < 6000; i++) {
      sim.step(16, IDLE);
      if (agent.behavior.kind === "dwelling") {
        expect(agent.x).toBe(coffee.stand.x);
        expect(agent.y).toBe(coffee.stand.y);
        reachedCoffee = true;
      }
      if (reachedCoffee && agent.behavior.kind === "seated") {
        backSeated = true;
        break;
      }
    }
    expect(reachedCoffee).toBe(true);
    expect(backSeated).toBe(true);
    expect(agent.x).toBe(agent.seat.x);
    expect(agent.y).toBe(agent.seat.y);
    expect(agent.carrying).toBe("coffee");
  });

  test("agents running, queued, cooling down or blocked never leave their desk", () => {
    for (const state of ["running", "queued", "cooldown", "blocked"] as const) {
      const sim = new OfficeSimulation(() => 0);
      sim.sync([agentInput("ceo", "c_suite", state), agentInput("a", "staff", state)]);
      for (let i = 0; i < 6000; i++) {
        sim.step(16, IDLE);
        for (const agent of sim.agents) expect(agent.behavior.kind).toBe("seated");
      }
    }
  });

  test("an idle refresh keeps a break going; a run starting sends the agent straight back to the desk", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a")]);
    const agent = sim.agents[0];
    for (let i = 0; i < 3000 && agent.behavior.kind === "seated"; i++) sim.step(16, IDLE);
    for (let i = 0; i < 30; i++) sim.step(16, IDLE);
    expect(agent.behavior.kind).toBe("walking");
    expect(agent.behavior.kind === "walking" && agent.behavior.destination).toBe("amenity");

    sim.sync([agentInput("a")]);
    expect(sim.agents[0].behavior.kind === "walking" && sim.agents[0].behavior.destination).toBe("amenity");

    sim.sync([agentInput("a", "staff", "running")]);
    const working = sim.agents[0];
    expect(working.behavior.kind === "walking" && working.behavior.destination).toBe("seat");
    for (let i = 0; i < 6000 && working.behavior.kind !== "seated"; i++) {
      sim.step(16, IDLE);
      expect(working.behavior.kind).not.toBe("dwelling");
    }
    expect(working.x).toBe(working.seat.x);
    expect(working.y).toBe(working.seat.y);
  });

  test("only idle agents gather around the table, and anyone with a run stays at their desk", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a"), agentInput("b"), agentInput("ceo", "c_suite", "running")]);
    // Nobody has settled yet: a meeting cannot be convened.
    expect(sim.conveneMeeting()).toBe(0);
    for (const agent of sim.agents) agent.settledMs = 30_000;

    const attendees = sim.conveneMeeting();
    expect(attendees).toBeGreaterThanOrEqual(2);
    expect(attendees).toBe(2);
    const walkers = sim.agents.filter((agent) => agent.behavior.kind === "walking");
    expect(walkers).toHaveLength(attendees);
    expect(sim.agents.find((agent) => agent.input.id === "ceo")!.behavior.kind).toBe("seated");
    const spots = new Set(
      walkers.map((agent) => (agent.behavior.kind === "walking" ? `${agent.behavior.spot?.stand.x}` : "")),
    );
    expect(spots.size).toBe(attendees);

    // Everyone reaches the meeting room, dwells together, and heads home.
    let overlapped = false;
    for (let i = 0; i < 12000 && !overlapped; i++) {
      sim.step(16, IDLE);
      const dwellingInMeeting = sim.agents.filter(
        (agent) => agent.behavior.kind === "dwelling" && agent.behavior.spot.kind === "meeting",
      );
      if (dwellingInMeeting.length >= 2) overlapped = true;
    }
    expect(overlapped).toBe(true);
  });

  test("a solo office never convenes a meeting", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a")]);
    sim.agents[0].settledMs = 30_000;
    expect(sim.conveneMeeting()).toBe(0);
    expect(sim.agents[0].behavior.kind).toBe("seated");
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
