import { describe, expect, test } from "vitest";
import { OfficeSimulation, cameraFor, type MoveInput } from "../../src/renderer/src/pages/office/simulation";
import type { AgentActivity, OfficeAgentInput } from "../../src/renderer/src/pages/office/office-types";

const IDLE: MoveInput = { up: false, down: false, left: false, right: false };

function agentInput(id: string, roleLevel = "staff", activity: AgentActivity = "idle"): OfficeAgentInput {
  return {
    id,
    name: `Agent ${id}`,
    role: "Engineer",
    title: "Engineer",
    department: "Engineering",
    roleLevel,
    activity,
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

  test("working agents (and the CEO) take breaks too", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("ceo", "c_suite", "active")]);
    const agent = sim.agents[0];
    let leftTheDesk = false;
    for (let i = 0; i < 3000 && !leftTheDesk; i++) {
      sim.step(16, IDLE);
      if (agent.behavior.kind !== "seated") leftTheDesk = true;
    }
    expect(leftTheDesk).toBe(true);
  });

  test("a snapshot refresh mid-break never recalls the walker", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a")]);
    const agent = sim.agents[0];
    for (let i = 0; i < 3000 && agent.behavior.kind === "seated"; i++) sim.step(16, IDLE);
    for (let i = 0; i < 30; i++) sim.step(16, IDLE);
    expect(agent.behavior.kind).toBe("walking");

    // Becoming busy does not cancel the human ritual of a coffee run.
    sim.sync([agentInput("a", "staff", "active")]);
    const refreshed = sim.agents[0];
    expect(refreshed.behavior.kind).toBe("walking");
    let dwelled = false;
    for (let i = 0; i < 6000 && !dwelled; i++) {
      sim.step(16, IDLE);
      if (refreshed.behavior.kind === "dwelling") dwelled = true;
    }
    expect(dwelled).toBe(true);
  });

  test("meetings convene at least two attendees around the table, then everyone returns", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a", "staff", "active"), agentInput("b"), agentInput("ceo", "c_suite", "active")]);
    // Nobody has settled yet: a meeting cannot be convened.
    expect(sim.conveneMeeting()).toBe(0);
    for (const agent of sim.agents) agent.settledMs = 30_000;

    const attendees = sim.conveneMeeting();
    expect(attendees).toBeGreaterThanOrEqual(2);
    const walkers = sim.agents.filter((agent) => agent.behavior.kind === "walking");
    expect(walkers).toHaveLength(attendees);
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

  test("the whip sends snack-bar and restroom slackers hustling home, snack abandoned", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a"), agentInput("b")]);
    const snacker = sim.agents[0];
    const snackSpot = sim.plan.amenities.find((spot) => spot.kind === "snack")!;
    snacker.x = snackSpot.stand.x;
    snacker.y = snackSpot.stand.y;
    snacker.carrying = "snack";
    snacker.behavior = { kind: "dwelling", spot: snackSpot, remainingMs: 60_000 };

    expect(sim.whip("a")).toBe(true);
    expect(snacker.behavior.kind).toBe("walking");
    expect(snacker.carrying).toBeNull();
    expect(snacker.hustleMs).toBeGreaterThan(0);

    const restroomSpot = sim.plan.amenities.find((spot) => spot.kind === "restroom")!;
    const rester = sim.agents[1];
    rester.x = restroomSpot.stand.x;
    rester.y = restroomSpot.stand.y;
    rester.behavior = { kind: "dwelling", spot: restroomSpot, remainingMs: 60_000 };
    expect(sim.whip("b")).toBe(true);
    expect(rester.behavior.kind).toBe("walking");

    // The whipped walker makes it back to their desk.
    for (let i = 0; i < 4000 && sim.agents[0].behavior.kind !== "seated"; i++) sim.step(16, IDLE);
    expect(snacker.x).toBe(snacker.seat.x);
    expect(snacker.y).toBe(snacker.seat.y);
  });

  test("the whip does nothing to agents at their desk or in a meeting", () => {
    const sim = new OfficeSimulation(() => 0);
    sim.sync([agentInput("a"), agentInput("b"), agentInput("ceo", "c_suite")]);
    // Seated at the desk: working, untouched.
    expect(sim.whip("a")).toBe(false);
    expect(sim.agents[0].behavior.kind).toBe("seated");

    // Dwelling in the meeting room: in a meeting, untouched.
    const meetingSpot = sim.plan.amenities.find((spot) => spot.kind === "meeting")!;
    const attendee = sim.agents[1];
    attendee.x = meetingSpot.stand.x;
    attendee.y = meetingSpot.stand.y;
    attendee.behavior = { kind: "dwelling", spot: meetingSpot, remainingMs: 20_000 };
    expect(sim.whip("b")).toBe(false);
    expect(attendee.behavior.kind).toBe("dwelling");

    // The CEO in their own office is working, untouched.
    expect(sim.whip("ceo")).toBe(false);
    expect(sim.whip("nobody")).toBe(false);
  });

  test("clicks hit the agent drawn at that spot, frontmost first", () => {
    const sim = new OfficeSimulation();
    sim.sync([agentInput("a"), agentInput("b")]);
    const first = sim.agents[0];
    expect(sim.hitTest({ x: first.x, y: first.y - 10 })!.input.id).toBe("a");
    expect(sim.hitTest({ x: first.x - 60, y: first.y - 10 })).toBeNull();
    const second = sim.agents[1];
    second.x = first.x;
    second.y = first.y + 6;
    expect(sim.hitTest({ x: first.x, y: first.y })!.input.id).toBe("b");
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
