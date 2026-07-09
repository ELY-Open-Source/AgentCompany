export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RoomKind = "ceo" | "meeting" | "snack" | "restroom";

export interface RoomSpec {
  kind: RoomKind;
  label: string;
  /** Interior area, excluding surrounding walls. */
  bounds: Rect;
  /** Center x of the door opening on the corridor-facing south wall. */
  doorCx: number;
  /** Horizontal walking lane inside the room. */
  interiorLaneY: number;
}

export interface DeskSlot {
  index: number;
  bounds: Rect;
  /** Where the assigned person stands/sits, south of the desk. */
  seat: Vec;
}

export type AmenityKind = "coffee" | "snack" | "restroom" | "meeting";

export interface AmenitySpot {
  kind: AmenityKind;
  room: RoomKind;
  /** Where a visiting person stands while using the amenity. */
  stand: Vec;
}

export interface LaneGraph {
  nodes: Vec[];
  /** Adjacency as index pairs into `nodes`; every edge is axis-aligned. */
  edges: Array<[number, number]>;
}

export interface FloorPlan {
  world: { w: number; h: number };
  rooms: RoomSpec[];
  /** The CEO's dedicated desk inside the CEO office. */
  ceoDesk: Rect;
  ceoSeat: Vec;
  /** Open-floor desks, assigned to non-CEO agents in stable order. */
  desks: DeskSlot[];
  amenities: AmenitySpot[];
  /** Solid obstacles for player collision: walls and furniture. */
  colliders: Rect[];
  lanes: LaneGraph;
  /** Player spawn point, just inside the entrance. */
  entrance: Vec;
}

export type AgentActivity = "active" | "thinking" | "busy" | "idle";

/** Snapshot-derived facts the office simulation needs about one agent. */
export interface OfficeAgentInput {
  id: string;
  name: string;
  role: string;
  title: string;
  department: string;
  roleLevel: string;
  activity: AgentActivity;
  taskTitle: string | null;
}

export interface Camera {
  x: number;
  y: number;
}
