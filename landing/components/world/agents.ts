import { Group, Vector2, type Object3D } from "three";
import { INK } from "../../lib/palette";
import { CEO_DESK, DESKS, SHARED_SPOTS, deskSpot, type Point, type Spot } from "./layout";
import { box, type Inks } from "./voxel";

interface Rig {
  root: Group;
  torso: Group;
  head: Group;
  legs: [Group, Group];
  arms: [Group, Group];
}

interface Agent {
  rig: Rig;
  desk: Spot;
  spot: Spot;
  path: Vector2[];
  wait: number;
  stride: number;
  seed: number;
}

const HIP = 0.36;
const SEAT = 0.48;
const SPEED = 1.7;
const SCALE = 1.25;
const TEAM = [
  { shirt: INK.accent, hair: INK.woodDark },
  { shirt: INK.sea, hair: INK.ink },
  { shirt: INK.mint, hair: INK.brick },
  { shirt: INK.berry, hair: INK.gold },
  { shirt: INK.rug, hair: INK.woodDark },
  { shirt: INK.leaf1, hair: INK.ink },
];

function limb(parent: Object3D, inks: Inks, ink: number, x: number, y: number, w: number, h: number): Group {
  const pivot = new Group();
  pivot.position.set(x, y, 0);
  parent.add(pivot);
  box(pivot, inks[ink]!, w, h, w + 0.02, 0, -h, 0);
  return pivot;
}

function buildRig(inks: Inks, shirt: number, hair: number, ceo: boolean): Rig {
  const root = new Group();
  root.scale.setScalar(SCALE);
  const torso = new Group();
  root.add(torso);
  const legs: [Group, Group] = [limb(root, inks, INK.inkSoft, -0.11, HIP, 0.17, HIP), limb(root, inks, INK.inkSoft, 0.11, HIP, 0.17, HIP)];
  box(torso, inks[shirt]!, 0.46, 0.42, 0.3, 0, HIP, 0);
  if (ceo) box(torso, inks[INK.gold]!, 0.08, 0.3, 0.02, 0, HIP + 0.08, 0.15);
  const arms: [Group, Group] = [limb(torso, inks, shirt, -0.3, 0.76, 0.13, 0.36), limb(torso, inks, shirt, 0.3, 0.76, 0.13, 0.36)];
  const head = new Group();
  head.position.y = 0.78;
  torso.add(head);
  box(head, inks[INK.skin]!, 0.5, 0.46, 0.46, 0, 0, 0);
  box(head, inks[hair]!, 0.54, 0.14, 0.5, 0, 0.4, 0);
  box(head, inks[hair]!, 0.54, 0.3, 0.12, 0, 0.12, -0.21);
  if (ceo) {
    box(head, inks[INK.void]!, 0.44, 0.1, 0.04, 0, 0.2, 0.24);
    box(head, inks[INK.gold]!, 0.4, 0.1, 0.4, 0, 0.54, 0);
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]] as Point[]) box(head, inks[INK.gold]!, 0.1, 0.16, 0.1, x, 0.64, z);
    box(head, inks[INK.accent]!, 0.1, 0.1, 0.04, 0, 0.55, 0.21);
  } else {
    for (const x of [-0.12, 0.12]) box(head, inks[INK.void]!, 0.07, 0.1, 0.03, x, 0.18, 0.235);
  }
  return { root, torso, head, legs, arms };
}

function turn(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, amount);
}

/** Seven blocky staff (CEO first, crowned) cycling desk → coffee / meeting → desk along corridor waypoints. */
export function createAgents(inks: Inks): { root: Group; update(dt: number, time: number): void } {
  const root = new Group();
  const taken = new Set<Spot>();
  const desks = [CEO_DESK, ...DESKS].map(deskSpot);
  const agents: Agent[] = desks.map((desk, i) => {
    const look = i === 0 ? { shirt: INK.ink, hair: INK.ink } : TEAM[i - 1]!;
    const rig = buildRig(inks, look.shirt, look.hair, i === 0);
    root.add(rig.root);
    rig.root.position.set(desk.at[0], 0, desk.at[1]);
    rig.root.rotation.y = desk.face;
    return { rig, desk, spot: desk, path: [], wait: 2 + i * 1.7, stride: 0, seed: i * 1.37 };
  });

  const route = (from: Spot, to: Spot) =>
    [...from.exit, ...[...to.exit].reverse(), to.at].map(([x, z]) => new Vector2(x, z));

  function choose(agent: Agent): void {
    let next = agent.desk;
    if (agent.spot === agent.desk) {
      const kind = Math.random() < 0.45 ? "coffee" : "meeting";
      const free = SHARED_SPOTS.filter((s) => s.kind === kind && !taken.has(s));
      if (free.length === 0) {
        agent.wait = 3;
        return;
      }
      next = free[Math.floor(Math.random() * free.length)]!;
      taken.add(next);
    } else {
      taken.delete(agent.spot);
    }
    agent.path = route(agent.spot, next);
    agent.spot = next;
  }

  function pose(agent: Agent, dt: number, time: number): void {
    const { rig, spot } = agent;
    const walking = agent.path.length > 0;
    const seated = !walking && spot.sit;
    const swing = walking ? Math.sin(agent.stride) * 0.7 : 0;
    rig.legs[0].rotation.x = seated ? -Math.PI / 2 : swing;
    rig.legs[1].rotation.x = seated ? -Math.PI / 2 : -swing;
    rig.root.position.y = seated ? SEAT - HIP * SCALE : walking ? Math.abs(Math.sin(agent.stride)) * 0.06 : 0;
    const tap = Math.sin(time * 16 + agent.seed * 5);
    if (walking) {
      rig.arms[0].rotation.x = -swing * 0.8;
      rig.arms[1].rotation.x = swing * 0.8;
    } else if (spot.kind === "desk") {
      rig.arms[0].rotation.x = -1.2 + tap * 0.15;
      rig.arms[1].rotation.x = -1.2 - tap * 0.15;
    } else if (spot.kind === "coffee") {
      const sip = Math.sin(time * 1.3 + agent.seed) > 0.4;
      rig.arms[0].rotation.x = 0;
      rig.arms[1].rotation.x = sip ? -2.2 : -0.9;
    } else {
      rig.arms[0].rotation.x = rig.arms[1].rotation.x = -0.7;
    }
    rig.torso.position.y = !walking && spot.kind === "desk" ? (tap > 0.6 ? 0.03 : 0) : 0;
    rig.head.rotation.x = !walking && spot.kind === "meeting" ? Math.max(0, Math.sin(time * 2 + agent.seed)) * 0.25 : 0;
    if (!walking) rig.root.rotation.y = turn(rig.root.rotation.y, spot.face, dt * 8);
  }

  return {
    root,
    update(dt, time) {
      for (const agent of agents) {
        const { rig } = agent;
        const target = agent.path[0];
        if (target) {
          const here = new Vector2(rig.root.position.x, rig.root.position.z);
          const gap = target.clone().sub(here);
          const step = SPEED * dt;
          if (gap.length() <= step) {
            rig.root.position.x = target.x;
            rig.root.position.z = target.y;
            agent.path.shift();
            if (agent.path.length === 0) agent.wait = agent.spot === agent.desk ? 8 + Math.random() * 8 : 5 + Math.random() * 6;
          } else {
            gap.normalize();
            rig.root.position.x += gap.x * step;
            rig.root.position.z += gap.y * step;
            rig.root.rotation.y = turn(rig.root.rotation.y, Math.atan2(gap.x, gap.y), dt * 12);
            agent.stride += dt * 11;
          }
        } else {
          agent.wait -= dt;
          if (agent.wait <= 0) choose(agent);
        }
        pose(agent, dt, time);
      }
    },
  };
}
