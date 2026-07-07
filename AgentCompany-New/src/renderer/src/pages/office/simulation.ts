import { buildFloorPlan } from "./floor-plan";
import type { Camera, FloorPlan, OfficeAgentInput, Vec } from "./office-types";

export interface AgentSim {
  input: OfficeAgentInput;
  x: number;
  y: number;
  seat: Vec;
  deskIndex: number | null;
  isCeo: boolean;
}

/**
 * Holds the living state of the office: who sits where and where everyone
 * currently stands. Snapshot changes flow in through `sync`, which keeps
 * existing positions stable so people never teleport when data refreshes.
 */
export class OfficeSimulation {
  plan: FloorPlan;
  agents: AgentSim[] = [];
  private openDeskDemand = -1;

  constructor() {
    this.plan = buildFloorPlan(0);
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
