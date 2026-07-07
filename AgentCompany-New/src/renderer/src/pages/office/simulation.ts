import { buildFloorPlan } from "./floor-plan";
import type { Camera, FloorPlan, OfficeAgentInput, Rect, Vec } from "./office-types";
import { appearanceFor, type Carrying, type Facing, type SpriteAppearance } from "./sprites";

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
const MAX_STEP_MS = 100;
const WALK_CYCLE = 0.02;

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

  constructor() {
    this.plan = buildFloorPlan(0);
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

  /** Advances the world by one frame: board-member movement and collision. */
  step(dtMs: number, input: MoveInput): void {
    const dt = Math.min(dtMs, MAX_STEP_MS);
    if (this.player) this.stepPlayer(this.player, dt, input);
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
    if (openCount !== this.openDeskDemand) {
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
      return {
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
      };
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
