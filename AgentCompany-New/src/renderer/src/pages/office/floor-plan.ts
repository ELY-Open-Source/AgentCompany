import type { AmenitySpot, DeskSlot, FloorPlan, LaneGraph, Rect, RoomSpec, Vec } from "./office-types";

/**
 * Fixed-size world geometry (logical px). The office is a north band of rooms
 * (CEO office, meeting room, snack bar, restroom) opening onto an east-west
 * corridor, with the open desk field growing downward row by row. All
 * movement rides an axis-aligned lane graph built from the same constants,
 * so walkable space is correct by construction.
 */
export const WORLD_W = 1216;
export const WALL = 16;

const ROOM_TOP = WALL;
const ROOM_BOTTOM = 272;
const ROOM_WALL_BOTTOM = ROOM_BOTTOM + WALL;
export const CORRIDOR_Y = 320;
const CORRIDOR_MIN_X = 48;
const CORRIDOR_MAX_X = 1176;
const INTERIOR_LANE_Y = 232;
const DOOR_HALF = 24;

const DESK_W = 80;
const DESK_H = 40;
const DESK_TOP0 = 384;
const ROW_PITCH = 128;
const DESK_COLS = [144, 368, 592, 816, 1040];
const AISLE_XS = [104, 296, 520, 744, 968, 1160];
const SEAT_DROP = 54;
const ROW_LANE_DROP = 88;
const MIN_DESK_ROWS = 2;

const CEO_DESK: Rect = { x: 100, y: 120, w: 120, h: 40 };
const CEO_SEAT: Vec = { x: 160, y: 182 };
const CEO_SOFA: Rect = { x: 32, y: 96, w: 24, h: 72 };
const CEO_PLANT: Rect = { x: 268, y: 24, w: 24, h: 24 };
const MEETING_TABLE: Rect = { x: 392, y: 120, w: 160, h: 64 };
const SNACK_COUNTER: Rect = { x: 656, y: 40, w: 224, h: 28 };
const SNACK_TABLE: Rect = { x: 748, y: 170, w: 40, h: 40 };
const RESTROOM_STALLS: Rect = { x: 1064, y: WALL, w: 120, h: 72 };
const RESTROOM_SINKS: Rect = { x: 928, y: 32, w: 96, h: 32 };
const CORRIDOR_PLANTS: Rect[] = [
  { x: 302, y: 290, w: 20, h: 20 },
  { x: 622, y: 290, w: 20, h: 20 },
  { x: 894, y: 290, w: 20, h: 20 },
];

const ROOMS: RoomSpec[] = [
  { kind: "ceo", label: "CEO OFFICE", bounds: { x: 16, y: ROOM_TOP, w: 288, h: 256 }, doorCx: 160, interiorLaneY: INTERIOR_LANE_Y },
  { kind: "meeting", label: "MEETING ROOM", bounds: { x: 320, y: ROOM_TOP, w: 304, h: 256 }, doorCx: 472, interiorLaneY: INTERIOR_LANE_Y },
  { kind: "snack", label: "SNACK BAR", bounds: { x: 640, y: ROOM_TOP, w: 256, h: 256 }, doorCx: 768, interiorLaneY: INTERIOR_LANE_Y },
  { kind: "restroom", label: "RESTROOM", bounds: { x: 912, y: ROOM_TOP, w: 288, h: 256 }, doorCx: 1056, interiorLaneY: INTERIOR_LANE_Y },
];

const AMENITIES: AmenitySpot[] = [
  { kind: "coffee", room: "snack", stand: { x: 704, y: 92 } },
  { kind: "snack", room: "snack", stand: { x: 840, y: 92 } },
  { kind: "restroom", room: "restroom", stand: { x: 1084, y: 104 } },
  { kind: "restroom", room: "restroom", stand: { x: 1124, y: 104 } },
  { kind: "restroom", room: "restroom", stand: { x: 1164, y: 104 } },
];

interface Segment {
  a: Vec;
  b: Vec;
}

export function buildFloorPlan(openDeskCount: number): FloorPlan {
  const rows = Math.max(MIN_DESK_ROWS, Math.ceil(Math.max(openDeskCount, 0) / DESK_COLS.length));
  const desks = buildDesks(rows);
  const lastRowLane = rowLaneY(rows - 1);
  const worldH = lastRowLane + 64;

  const colliders: Rect[] = [
    { x: 0, y: 0, w: WORLD_W, h: WALL },
    { x: 0, y: WALL, w: WALL, h: 280 },
    { x: 0, y: 344, w: WALL, h: worldH - 344 - WALL },
    { x: WORLD_W - WALL, y: WALL, w: WALL, h: worldH - 2 * WALL },
    { x: 0, y: worldH - WALL, w: WORLD_W, h: WALL },
    { x: 304, y: ROOM_TOP, w: WALL, h: ROOM_WALL_BOTTOM - ROOM_TOP },
    { x: 624, y: ROOM_TOP, w: WALL, h: ROOM_WALL_BOTTOM - ROOM_TOP },
    { x: 896, y: ROOM_TOP, w: WALL, h: ROOM_WALL_BOTTOM - ROOM_TOP },
    ...southWallsWithDoors(),
    CEO_DESK,
    CEO_SOFA,
    CEO_PLANT,
    MEETING_TABLE,
    SNACK_COUNTER,
    SNACK_TABLE,
    RESTROOM_STALLS,
    RESTROOM_SINKS,
    ...CORRIDOR_PLANTS,
    ...desks.map((desk) => desk.bounds),
  ];

  return {
    world: { w: WORLD_W, h: worldH },
    rooms: ROOMS,
    ceoDesk: CEO_DESK,
    ceoSeat: CEO_SEAT,
    desks,
    amenities: AMENITIES,
    colliders,
    lanes: buildLaneGraph(rows, desks),
    entrance: { x: CORRIDOR_MIN_X, y: CORRIDOR_Y },
  };
}

function rowLaneY(row: number): number {
  return DESK_TOP0 + row * ROW_PITCH + ROW_LANE_DROP;
}

function buildDesks(rows: number): DeskSlot[] {
  const desks: DeskSlot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < DESK_COLS.length; col++) {
      const x = DESK_COLS[col];
      const y = DESK_TOP0 + row * ROW_PITCH;
      desks.push({
        index: desks.length,
        bounds: { x, y, w: DESK_W, h: DESK_H },
        seat: { x: x + DESK_W / 2, y: y + SEAT_DROP },
      });
    }
  }
  return desks;
}

function southWallsWithDoors(): Rect[] {
  const walls: Rect[] = [];
  for (const room of ROOMS) {
    const left = room.bounds.x;
    const right = room.bounds.x + room.bounds.w;
    const gapLeft = room.doorCx - DOOR_HALF;
    const gapRight = room.doorCx + DOOR_HALF;
    walls.push({ x: left, y: ROOM_BOTTOM, w: gapLeft - left, h: WALL });
    walls.push({ x: gapRight, y: ROOM_BOTTOM, w: right - gapRight, h: WALL });
  }
  return walls;
}

function buildSegments(rows: number, desks: DeskSlot[]): Segment[] {
  const segments: Segment[] = [
    { a: { x: CORRIDOR_MIN_X, y: CORRIDOR_Y }, b: { x: CORRIDOR_MAX_X, y: CORRIDOR_Y } },
  ];
  for (let row = 0; row < rows; row++) {
    const y = rowLaneY(row);
    segments.push({ a: { x: AISLE_XS[0], y }, b: { x: AISLE_XS[AISLE_XS.length - 1], y } });
  }
  const lastLane = rowLaneY(rows - 1);
  for (const x of AISLE_XS) {
    segments.push({ a: { x, y: CORRIDOR_Y }, b: { x, y: lastLane } });
  }
  for (const room of ROOMS) {
    const laneMinX = room.bounds.x + 24;
    const laneMaxX = room.bounds.x + room.bounds.w - 24;
    segments.push({ a: { x: laneMinX, y: room.interiorLaneY }, b: { x: laneMaxX, y: room.interiorLaneY } });
    segments.push({ a: { x: room.doorCx, y: room.interiorLaneY }, b: { x: room.doorCx, y: CORRIDOR_Y } });
  }
  segments.push({ a: { x: CEO_SEAT.x, y: CEO_SEAT.y }, b: { x: CEO_SEAT.x, y: INTERIOR_LANE_Y } });
  for (const spot of AMENITIES) {
    segments.push({ a: { x: spot.stand.x, y: spot.stand.y }, b: { x: spot.stand.x, y: INTERIOR_LANE_Y } });
  }
  for (const desk of desks) {
    const lane = desk.bounds.y + ROW_LANE_DROP;
    segments.push({ a: { x: desk.seat.x, y: desk.seat.y }, b: { x: desk.seat.x, y: lane } });
  }
  return segments;
}

function buildLaneGraph(rows: number, desks: DeskSlot[]): LaneGraph {
  const segments = buildSegments(rows, desks);
  const nodes: Vec[] = [];
  const nodeIndex = new Map<string, number>();
  const edges = new Set<string>();

  const keyOf = (p: Vec) => `${p.x},${p.y}`;
  const addNode = (p: Vec): number => {
    const key = keyOf(p);
    const existing = nodeIndex.get(key);
    if (existing !== undefined) return existing;
    nodes.push({ x: p.x, y: p.y });
    nodeIndex.set(key, nodes.length - 1);
    return nodes.length - 1;
  };

  for (const segment of segments) {
    const points = pointsOnSegment(segment, segments);
    for (let i = 0; i + 1 < points.length; i++) {
      const a = addNode(points[i]);
      const b = addNode(points[i + 1]);
      if (a === b) continue;
      edges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }

  return {
    nodes,
    edges: [...edges].map((pair) => {
      const [a, b] = pair.split("|");
      return [Number(a), Number(b)] as [number, number];
    }),
  };
}

function pointsOnSegment(segment: Segment, all: Segment[]): Vec[] {
  const points: Vec[] = [segment.a, segment.b];
  for (const other of all) {
    if (other === segment) continue;
    const hit = intersection(segment, other);
    if (hit) points.push(hit);
  }
  const horizontal = segment.a.y === segment.b.y;
  points.sort((p, q) => (horizontal ? p.x - q.x : p.y - q.y));
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

function intersection(s1: Segment, s2: Segment): Vec | null {
  const h1 = s1.a.y === s1.b.y;
  const h2 = s2.a.y === s2.b.y;
  if (h1 === h2) return null;
  const horizontal = h1 ? s1 : s2;
  const vertical = h1 ? s2 : s1;
  const [hx1, hx2] = [Math.min(horizontal.a.x, horizontal.b.x), Math.max(horizontal.a.x, horizontal.b.x)];
  const [vy1, vy2] = [Math.min(vertical.a.y, vertical.b.y), Math.max(vertical.a.y, vertical.b.y)];
  const x = vertical.a.x;
  const y = horizontal.a.y;
  if (x < hx1 || x > hx2 || y < vy1 || y > vy2) return null;
  return { x, y };
}

/**
 * Shortest lane path between two world points. Both endpoints snap to their
 * nearest lane node, so a walker interrupted mid-lane re-routes correctly.
 * Returns waypoints including `from` and `to`, with collinear points removed.
 */
export function findPath(plan: FloorPlan, from: Vec, to: Vec): Vec[] {
  const start = nearestNode(plan.lanes, from);
  const goal = nearestNode(plan.lanes, to);
  const nodePath = bfs(plan.lanes, start, goal);
  const waypoints = [from, ...nodePath.map((i) => plan.lanes.nodes[i]), to];
  return simplify(waypoints);
}

function nearestNode(lanes: LaneGraph, p: Vec): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lanes.nodes.length; i++) {
    const node = lanes.nodes[i];
    const dist = Math.abs(node.x - p.x) + Math.abs(node.y - p.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function bfs(lanes: LaneGraph, start: number, goal: number): number[] {
  if (start === goal) return [start];
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of lanes.edges) {
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
  }
  const previous = new Map<number, number>();
  const queue = [start];
  previous.set(start, start);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === goal) break;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(goal)) {
    throw new Error(`Office lane graph is disconnected between nodes ${start} and ${goal}`);
  }
  const path: number[] = [];
  for (let node = goal; node !== start; node = previous.get(node)!) path.unshift(node);
  path.unshift(start);
  return path;
}

function simplify(points: Vec[]): Vec[] {
  const result: Vec[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const beforeLast = result[result.length - 2];
    if (
      last && beforeLast &&
      ((last.x === point.x && beforeLast.x === point.x) || (last.y === point.y && beforeLast.y === point.y))
    ) {
      result[result.length - 1] = point;
      continue;
    }
    result.push(point);
  }
  return result;
}

export function rectContains(rect: Rect, p: Vec): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
