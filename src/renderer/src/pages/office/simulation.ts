import { buildFloorPlan, findPath } from "./floor-plan";
import type { AmenitySpot, Camera, FloorPlan, OfficeAgentInput, Rect, Vec } from "./office-types";
import { appearanceFor, type Carrying, type Facing, type SpriteAppearance } from "./sprites";

export type AgentBehavior =
  | { kind: "seated" }
  | { kind: "walking"; path: Vec[]; next: number; destination: "amenity" | "seat"; spot: AmenitySpot | null }
  | { kind: "dwelling"; spot: AmenitySpot; remainingMs: number };

export interface AgentSim {
  input: OfficeAgentInput;
  x: number;
  y: number;
  seat: Vec;
  deskIndex: number | null;
  isCeo: boolean;
  appearance: SpriteAppearance;
  facing: Facing;
  walkPhase: number;
  carrying: Carrying;
  behavior: AgentBehavior;
  carryRemainingMs: number;
  settledMs: number;
}

export interface PlayerSim {
  employeeId: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  walkPhase: number;
  appearance: SpriteAppearance;
}

export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const PLAYER_SPEED = 0.14;
const AGENT_SPEED = 0.085;
const MAX_STEP_MS = 100;
const WALK_CYCLE = 0.02;
/** Everyone wanders off roughly every minute and a half, working or not. */
const MEAN_TRIP_INTERVAL_MS = 90_000;
/** Nobody leaves their desk in the first moments after settling in. */
const SETTLE_MS = 20_000;
const DWELL_MIN_MS = 6_000;
const DWELL_SPREAD_MS = 8_000;
/** Meetings run longer than a snack stop so attendees visibly overlap. */
const MEETING_MIN_MS = 18_000;
const MEETING_SPREAD_MS = 12_000;
/** A meeting is convened somewhere in the office every few minutes. */
const MEAN_MEETING_INTERVAL_MS = 180_000;
const CARRY_MIN_MS = 20_000;
const CARRY_SPREAD_MS = 20_000;

/**
 * Holds the living state of the office: who sits where and where everyone
 * currently stands. Snapshot changes flow in through `sync`, which keeps
 * existing positions stable so people never teleport when data refreshes.
 */
export class OfficeSimulation {
  plan: FloorPlan;
  agents: AgentSim[] = [];
  player: PlayerSim | null = null;
  private openDeskDemand = -1;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.plan = buildFloorPlan(0);
    this.random = random;
  }

  /**
   * Ensures the signed-in employee walks the floor as the board member. The
   * avatar spawns at the entrance once and keeps its position across
   * snapshot refreshes.
   */
  syncPlayer(employeeId: string, displayName: string): void {
    if (this.player && this.player.employeeId === employeeId) {
      this.player.name = displayName;
      return;
    }
    const boardLook = appearanceFor(employeeId, false);
    this.player = {
      employeeId,
      name: displayName,
      x: this.plan.entrance.x,
      y: this.plan.entrance.y,
      facing: "east",
      walkPhase: 0,
      appearance: { ...boardLook, outfit: "blazer", accent: "#e5c65a", hairStyle: boardLook.hairStyle === "bald" ? "short" : boardLook.hairStyle },
    };
  }

  /**
   * Advances the world by one frame: board-member movement plus agent life.
   * Everyone — the CEO and working agents included — periodically wanders to
   * the restroom, snack bar, or coffee machine, and every few minutes the
   * office convenes a meeting of at least two attendees around the table.
   */
  step(dtMs: number, input: MoveInput): void {
    const dt = Math.min(dtMs, MAX_STEP_MS);
    if (this.player) this.stepPlayer(this.player, dt, input);
    for (const agent of this.agents) this.stepAgent(agent, dt);
    if (this.random() < dt / MEAN_MEETING_INTERVAL_MS) this.conveneMeeting();
  }

  private stepAgent(agent: AgentSim, dt: number): void {
    if (agent.carryRemainingMs > 0) {
      agent.carryRemainingMs -= dt;
      if (agent.carryRemainingMs <= 0) {
        agent.carryRemainingMs = 0;
        agent.carrying = null;
      }
    }
    switch (agent.behavior.kind) {
      case "seated": {
        agent.settledMs += dt;
        if (agent.settledMs >= SETTLE_MS && this.random() < dt / MEAN_TRIP_INTERVAL_MS) {
          agent.settledMs = 0;
          this.startTrip(agent);
        }
        return;
      }
      case "walking": {
        this.walkAlong(agent, dt);
        return;
      }
      case "dwelling": {
        agent.behavior.remainingMs -= dt;
        if (agent.behavior.remainingMs <= 0) this.finishDwell(agent);
        return;
      }
    }
  }

  private startTrip(agent: AgentSim): void {
    this.walkTo(agent, this.pickAmenity());
  }

  private walkTo(agent: AgentSim, spot: AmenitySpot): void {
    agent.behavior = {
      kind: "walking",
      path: findPath(this.plan, { x: agent.x, y: agent.y }, spot.stand),
      next: 1,
      destination: "amenity",
      spot,
    };
  }

  /** Solo breaks pick a personal amenity; meetings are convened separately. */
  private pickAmenity(): AmenitySpot {
    const roll = this.random();
    const kind = roll < 0.4 ? "coffee" : roll < 0.65 ? "snack" : "restroom";
    const options = this.plan.amenities.filter((spot) => spot.kind === kind);
    return options[Math.floor(this.random() * options.length) % options.length];
  }

  /**
   * Gathers a group around the meeting table. A meeting needs at least two
   * settled attendees; with fewer, nobody goes to sit alone in the room.
   * Returns the number of attendees who set off.
   */
  conveneMeeting(): number {
    const spots = this.plan.amenities.filter((spot) => spot.kind === "meeting");
    const candidates = this.agents.filter(
      (agent) => agent.behavior.kind === "seated" && agent.settledMs >= SETTLE_MS,
    );
    if (candidates.length < 2 || spots.length < 2) return 0;
    const size = Math.min(spots.length, candidates.length, 2 + Math.floor(this.random() * 3));
    const pool = [...candidates];
    const chosen: AgentSim[] = [];
    while (chosen.length < size && pool.length > 0) {
      const index = Math.floor(this.random() * pool.length) % pool.length;
      chosen.push(pool.splice(index, 1)[0]);
    }
    chosen.forEach((agent, position) => {
      agent.settledMs = 0;
      this.walkTo(agent, spots[position]);
    });
    return chosen.length;
  }

  private finishDwell(agent: AgentSim): void {
    if (agent.behavior.kind === "dwelling") {
      const kind = agent.behavior.spot.kind;
      if (kind === "coffee" || kind === "snack") {
        agent.carrying = kind;
        agent.carryRemainingMs = CARRY_MIN_MS + this.random() * CARRY_SPREAD_MS;
      }
    }
    this.sendHome(agent);
  }

  private sendHome(agent: AgentSim): void {
    agent.behavior = {
      kind: "walking",
      path: findPath(this.plan, { x: agent.x, y: agent.y }, agent.seat),
      next: 1,
      destination: "seat",
      spot: null,
    };
  }

  private walkAlong(agent: AgentSim, dt: number): void {
    if (agent.behavior.kind !== "walking") return;
    let budget = AGENT_SPEED * dt;
    while (budget > 0) {
      const target = agent.behavior.path[agent.behavior.next];
      if (!target) {
        this.arrive(agent);
        return;
      }
      const dx = target.x - agent.x;
      const dy = target.y - agent.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        agent.x = target.x;
        agent.y = target.y;
        agent.behavior.next += 1;
        budget -= distance;
        continue;
      }
      agent.x += (dx / distance) * budget;
      agent.y += (dy / distance) * budget;
      agent.facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "west" : "east") : (dy < 0 ? "north" : "south");
      budget = 0;
    }
    agent.walkPhase += dt * WALK_CYCLE;
  }

  private arrive(agent: AgentSim): void {
    if (agent.behavior.kind !== "walking") return;
    agent.walkPhase = 0;
    if (agent.behavior.destination === "amenity" && agent.behavior.spot) {
      const meeting = agent.behavior.spot.kind === "meeting";
      agent.facing = "north";
      agent.behavior = {
        kind: "dwelling",
        spot: agent.behavior.spot,
        remainingMs: meeting
          ? MEETING_MIN_MS + this.random() * MEETING_SPREAD_MS
          : DWELL_MIN_MS + this.random() * DWELL_SPREAD_MS,
      };
      return;
    }
    agent.facing = "south";
    agent.behavior = { kind: "seated" };
  }

  /**
   * Returns the agent whose drawn body contains the world point, preferring
   * the visually frontmost (largest y). Tests against the same positions the
   * renderer draws, so clicks always match what is on screen.
   */
  hitTest(point: Vec): AgentSim | null {
    let hit: AgentSim | null = null;
    for (const agent of this.agents) {
      const inBody =
        point.x >= agent.x - 10 && point.x <= agent.x + 10 &&
        point.y >= agent.y - 36 && point.y <= agent.y + 4;
      if (inBody && (hit === null || agent.y > hit.y)) hit = agent;
    }
    return hit;
  }

  private stepPlayer(player: PlayerSim, dt: number, input: MoveInput): void {
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx === 0 && dy === 0) {
      player.walkPhase = 0;
      return;
    }
    const norm = Math.hypot(dx, dy);
    dx /= norm;
    dy /= norm;
    const distance = PLAYER_SPEED * dt;
    player.x = this.slideAxis(player.x, player.y, dx * distance, 0).x;
    player.y = this.slideAxis(player.x, player.y, 0, dy * distance).y;
    player.x = clamp(player.x, 24, this.plan.world.w - 24);
    player.y = clamp(player.y, 40, this.plan.world.h - 8);
    player.facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "west" : "east") : (dy < 0 ? "north" : "south");
    player.walkPhase += dt * WALK_CYCLE;
  }

  private slideAxis(x: number, y: number, dx: number, dy: number): Vec {
    const next = { x: x + dx, y: y + dy };
    const body = footBox(next);
    for (const collider of this.plan.colliders) {
      if (boxesOverlap(body, collider)) return { x, y };
    }
    return next;
  }

  /**
   * Reconciles simulation state with the latest snapshot. The first
   * `c_suite` agent (stable input order) occupies the CEO office; everyone
   * else takes open-floor desks in order.
   */
  sync(inputs: OfficeAgentInput[]): void {
    const ceoId = inputs.find((input) => input.roleLevel === "c_suite")?.id ?? null;
    const openCount = inputs.filter((input) => input.id !== ceoId).length;
    const planRebuilt = openCount !== this.openDeskDemand;
    if (planRebuilt) {
      this.openDeskDemand = openCount;
      this.plan = buildFloorPlan(openCount);
    }

    const existing = new Map(this.agents.map((agent) => [agent.input.id, agent]));
    let openIndex = 0;
    this.agents = inputs.map((input) => {
      const isCeo = input.id === ceoId;
      const deskIndex = isCeo ? null : openIndex++;
      const seat = isCeo ? this.plan.ceoSeat : this.plan.desks[deskIndex!].seat;
      const prev = existing.get(input.id);
      const agent: AgentSim = {
        input,
        x: prev?.x ?? seat.x,
        y: prev?.y ?? seat.y,
        seat,
        deskIndex,
        isCeo,
        appearance: prev?.appearance ?? appearanceFor(input.id, isCeo),
        facing: prev?.facing ?? "south",
        walkPhase: prev?.walkPhase ?? 0,
        carrying: prev?.carrying ?? null,
        behavior: prev?.behavior ?? { kind: "seated" },
        carryRemainingMs: prev?.carryRemainingMs ?? 0,
        settledMs: prev?.settledMs ?? 0,
      };
      if (planRebuilt && prev && (agent.x !== seat.x || agent.y !== seat.y)) {
        this.sendHome(agent);
      }
      return agent;
    });
  }
}

/**
 * Camera top-left for a viewport centered on `focus`, clamped to the world.
 * When the world is smaller than the viewport on an axis, the world is
 * centered on that axis instead.
 */
export function cameraFor(world: { w: number; h: number }, viewW: number, viewH: number, focus: Vec): Camera {
  return {
    x: axisCamera(world.w, viewW, focus.x),
    y: axisCamera(world.h, viewH, focus.y),
  };
}

function axisCamera(worldSize: number, viewSize: number, focus: number): number {
  if (worldSize <= viewSize) return -(viewSize - worldSize) / 2;
  return Math.min(Math.max(focus - viewSize / 2, 0), worldSize - viewSize);
}

function footBox(position: Vec): Rect {
  return { x: position.x - 6, y: position.y - 8, w: 12, h: 10 };
}

function boxesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
