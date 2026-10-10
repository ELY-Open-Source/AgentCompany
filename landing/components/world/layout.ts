/** Floor plan shared by the office builder and the agents: x runs right, z towards the camera, units are voxels. */
export type Point = [x: number, z: number];

export interface Desk {
  x: number;
  z: number;
  /** +1 puts the chair on the +z side (screen faces the camera), -1 on the -z side. */
  facing: 1 | -1;
}

export interface Spot {
  kind: "desk" | "meeting" | "coffee";
  at: Point;
  face: number;
  sit: boolean;
  exit: Point[];
}

export const FLOOR = { halfX: 10, halfZ: 7, wall: 3.2 };
export const CORRIDOR = 1.2;
export const CEO_DESK: Desk = { x: -7, z: -4.9, facing: 1 };
export const DESKS: Desk[] = [
  { x: -2, z: -5, facing: 1 },
  { x: 2, z: -5, facing: 1 },
  { x: -5.5, z: 4.4, facing: -1 },
  { x: -2.5, z: 4.4, facing: -1 },
  { x: 2.5, z: 4.4, facing: -1 },
  { x: 5.5, z: 4.4, facing: -1 },
];
export const MEETING_TABLE: Point = [7, -4.2];
export const COFFEE_MACHINE: Point = [-9.5, 4.4];
export const WINDOWS = [-8.2, -5.4, -1.8, 1.8, 5.4, 8.2];

export function chairOf(desk: Desk): Point {
  return [desk.x, desk.z + desk.facing * 0.85];
}

export function deskSpot(desk: Desk): Spot {
  return { kind: "desk", at: chairOf(desk), face: desk.facing === 1 ? Math.PI : 0, sit: true, exit: [[desk.x, CORRIDOR]] };
}

const [tx, tz] = MEETING_TABLE;
const DOOR: Point = [tx, -2.1];
export const SHARED_SPOTS: Spot[] = [
  { kind: "meeting", at: [tx - 0.8, tz + 1.3], face: Math.PI, sit: true, exit: [DOOR, [tx, CORRIDOR]] },
  { kind: "meeting", at: [tx + 0.8, tz + 1.3], face: Math.PI, sit: true, exit: [DOOR, [tx, CORRIDOR]] },
  { kind: "meeting", at: [tx - 2.1, tz], face: Math.PI / 2, sit: true, exit: [[tx - 2.1, -2.1], DOOR, [tx, CORRIDOR]] },
  { kind: "meeting", at: [tx + 2.1, tz], face: -Math.PI / 2, sit: true, exit: [[tx + 2.1, -2.1], DOOR, [tx, CORRIDOR]] },
  { kind: "coffee", at: [-8.5, 4.4], face: -Math.PI / 2, sit: false, exit: [[-8.5, CORRIDOR]] },
  { kind: "coffee", at: [-8.5, 6.1], face: -Math.PI / 2, sit: false, exit: [[-7.8, 5.3], [-7.8, CORRIDOR]] },
];
