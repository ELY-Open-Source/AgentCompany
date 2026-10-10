import {
  BufferGeometry, DataTexture, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry,
  PointLight, Points, PointsMaterial, RepeatWrapping, type Object3D,
} from "three";
import { INK } from "../../lib/palette";
import { CEO_DESK, COFFEE_MACHINE, CORRIDOR, DESKS, FLOOR, MEETING_TABLE, SHARED_SPOTS, WINDOWS, chairOf, type Desk, type Point } from "./layout";
import { box, type Inks } from "./voxel";

export interface Office {
  root: Group;
  screens: MeshBasicMaterial[];
  lamps: PointLight[];
  glows: PointLight[];
  bulbs: MeshBasicMaterial;
  steam: PointsMaterial;
  update(time: number): void;
  dispose(): void;
}

const CODE_ROWS = 32;
const STEAM = 7;
const LAMPS: Point[] = [[-9.3, -4], [3.4, -1.7], [8.9, 2.4], [-0.1, 6.5]];

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function codeTexture(): DataTexture {
  const width = 8;
  const data = new Uint8Array(width * CODE_ROWS * 4);
  const next = random(7);
  for (let row = 0; row < CODE_ROWS; row++) {
    const indent = Math.floor(next() * 3);
    const length = 2 + Math.floor(next() * 5);
    const level = next() > 0.7 ? 150 : 255;
    for (let x = 0; x < width; x++) {
      const on = row % 2 === 0 && x >= indent && x < indent + length;
      data.fill(on ? level : 36, (row * width + x) * 4, (row * width + x) * 4 + 3);
      data[(row * width + x) * 4 + 3] = 255;
    }
  }
  const texture = new DataTexture(data, width, CODE_ROWS);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(1, 5 / CODE_ROWS);
  texture.needsUpdate = true;
  return texture;
}

/** Builds a piece locally (facing +z) and drops it into the room at (x, z) turned to `face`. */
function placed(parent: Object3D, x: number, z: number, face: number): Group {
  const group = new Group();
  group.position.set(x, 0, z);
  group.rotation.y = face;
  parent.add(group);
  return group;
}

function chair(parent: Object3D, inks: Inks, [x, z]: Point, face: number, seat: number = INK.accentDark): void {
  const g = placed(parent, x, z, face);
  box(g, inks[INK.inkSoft]!, 0.08, 0.38, 0.08, 0, 0, 0);
  box(g, inks[seat]!, 0.52, 0.1, 0.5, 0, 0.38, 0);
  box(g, inks[seat]!, 0.52, 0.42, 0.1, 0, 0.48, -0.24);
}

function plant(parent: Object3D, inks: Inks, x: number, z: number, scale = 1): void {
  const g = placed(parent, x, z, 0);
  g.scale.setScalar(scale);
  box(g, inks[INK.brick]!, 0.5, 0.42, 0.5, 0, 0, 0);
  box(g, inks[INK.woodDark]!, 0.42, 0.04, 0.42, 0, 0.42, 0);
  box(g, inks[INK.leaf0]!, 0.64, 0.42, 0.64, 0, 0.46, 0);
  box(g, inks[INK.leaf1]!, 0.5, 0.36, 0.5, 0.06, 0.82, 0.04);
  box(g, inks[INK.leaf2]!, 0.28, 0.26, 0.28, -0.08, 1.12, 0.1);
  box(g, inks[INK.bloom]!, 0.12, 0.12, 0.12, 0.26, 0.74, 0.26);
  box(g, inks[INK.bloom]!, 0.12, 0.12, 0.12, -0.2, 1.0, 0.24);
}

function desk(parent: Object3D, inks: Inks, d: Desk, screenGeometry: PlaneGeometry, screen: MeshBasicMaterial, ceo = false): void {
  const g = placed(parent, d.x, d.z, d.facing === 1 ? 0 : Math.PI);
  const width = ceo ? 2.3 : 1.6;
  const top = inks[ceo ? INK.woodDark : INK.wood]!;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, inks[INK.woodDark]!, 0.08, 0.7, 0.08, sx * (width / 2 - 0.1), 0, sz * 0.34);
  box(g, top, width, 0.08, 0.9, 0, 0.7, 0);
  if (ceo) {
    box(g, inks[INK.woodDark]!, width, 0.55, 0.06, 0, 0.15, 0.4);
    box(g, inks[INK.gold]!, width + 0.02, 0.06, 0.92, 0, 0.72, 0);
    box(g, inks[INK.gold]!, 0.14, 0.12, 0.14, 0.85, 0.78, 0.1);
    box(g, inks[INK.gold]!, 0.22, 0.14, 0.22, 0.85, 0.9, 0.1);
    box(g, inks[INK.gold]!, 0.5, 0.1, 0.06, -0.6, 0.78, 0.32);
  }
  box(g, inks[INK.inkSoft]!, 0.3, 0.03, 0.2, 0, 0.78, -0.2);
  box(g, inks[INK.inkSoft]!, 0.08, 0.16, 0.08, 0, 0.8, -0.22);
  box(g, inks[INK.ink]!, 0.84, 0.52, 0.06, 0, 0.92, -0.2);
  const panel = new Mesh(screenGeometry, screen);
  panel.position.set(0, 1.18, -0.165);
  g.add(panel);
  box(g, inks[INK.stoneLight]!, 0.5, 0.03, 0.16, 0, 0.78, 0.16);
  box(g, inks[INK.accent]!, 0.09, 0.11, 0.09, width / 2 - 0.22, 0.78, 0.12);
  chair(parent, inks, chairOf(d), d.facing === 1 ? Math.PI : 0, ceo ? INK.accent : INK.accentDark);
}

function wallRun(parent: Object3D, inks: Inks, [x1, z1]: Point, [x2, z2]: Point, height: number, thick: number, body: number = INK.paper): void {
  const w = Math.max(Math.abs(x2 - x1), thick);
  const d = Math.max(Math.abs(z2 - z1), thick);
  box(parent, inks[body]!, w, height, d, (x1 + x2) / 2, 0, (z1 + z2) / 2);
  box(parent, inks[INK.inkSoft]!, w + 0.04, 0.1, d + 0.04, (x1 + x2) / 2, height, (z1 + z2) / 2);
}

function shell(root: Object3D, inks: Inks): void {
  const { halfX, halfZ, wall } = FLOOR;
  const W = halfX * 2 + 0.6;
  const D = halfZ * 2 + 0.6;
  box(root, inks[INK.stone]!, W, 1.1, D, 0, -1.6, 0);
  box(root, inks[INK.brick]!, W, 0.4, D, 0, -0.5, 0);
  box(root, inks[INK.wood]!, W, 0.1, D, 0, -0.1, 0);
  for (let x = -halfX + 2; x < halfX; x += 2) box(root, inks[INK.woodDark]!, 0.1, 0.01, halfZ * 2, x, 0, 0);
  box(root, inks[INK.berry]!, 5.6, 0.03, 5.6, -7, 0, -4);
  box(root, inks[INK.stoneLight]!, 5.6, 0.03, 5.6, 7, 0, -4);
  box(root, inks[INK.rug]!, halfX * 2 - 1.4, 0.03, 1.1, 0, 0, CORRIDOR);

  const backZ = -halfZ - 0.15;
  box(root, inks[INK.paper]!, W, 0.9, 0.3, 0, 0, backZ);
  box(root, inks[INK.paper]!, W, wall - 2.6, 0.3, 0, 2.6, backZ);
  box(root, inks[INK.inkSoft]!, W + 0.04, 0.12, 0.34, 0, wall, backZ);
  const edges = [-W / 2, ...WINDOWS.flatMap((c) => [c - 1.1, c + 1.1]), W / 2];
  for (let i = 0; i < edges.length; i += 2) box(root, inks[INK.paper]!, edges[i + 1]! - edges[i]!, 1.7, 0.3, (edges[i]! + edges[i + 1]!) / 2, 0.9, backZ);
  for (const c of WINDOWS) {
    box(root, inks[INK.white]!, 2.3, 0.1, 0.5, c, 0.82, backZ + 0.05);
    box(root, inks[INK.white]!, 0.08, 1.7, 0.14, c, 0.9, backZ);
    box(root, inks[INK.white]!, 2.2, 0.08, 0.14, c, 1.75, backZ);
  }
  const leftX = -halfX - 0.15;
  box(root, inks[INK.paper]!, 0.3, wall, D, leftX, 0, 0);
  box(root, inks[INK.inkSoft]!, 0.34, 0.12, D + 0.04, leftX, wall, 0);
  box(root, inks[INK.stone]!, 0.04, 0.16, D, leftX + 0.17, 0, 0);
  box(root, inks[INK.stone]!, W, 0.16, 0.04, 0, 0, backZ + 0.17);

  const low = (a: Point, b: Point) => wallRun(root, inks, a, b, 0.9, 0.16, INK.stoneLight);
  low([-halfX, -1], [-7.9, -1]);
  low([-6.1, -1], [-4, -1]);
  low([-4, -halfZ], [-4, -1]);
  low([4, -1], [6.1, -1]);
  low([7.9, -1], [halfX, -1]);
  low([4, -halfZ], [4, -1]);
}

function furnish(root: Object3D, inks: Inks, bulbs: MeshBasicMaterial): void {
  const shelf = placed(root, -9.72, -6.0, Math.PI / 2);
  box(shelf, inks[INK.woodDark]!, 1.8, 2.1, 0.5, 0, 0, 0);
  const books = [INK.accent, INK.sea, INK.gold, INK.berry, INK.mint, INK.rug, INK.paper, INK.accentDark];
  const next = random(3);
  for (const y of [0.12, 0.8, 1.45]) {
    let x = -0.78;
    while (x < 0.7) {
      const w = 0.12 + next() * 0.1;
      box(shelf, inks[books[Math.floor(next() * books.length)]!]!, w - 0.02, 0.36 + next() * 0.14, 0.4, x + w / 2, y, 0.08);
      x += w;
    }
  }
  const board = placed(root, -9.97, 1.6, Math.PI / 2);
  box(board, inks[INK.stone]!, 2.6, 1.4, 0.06, 0, 1.05, 0);
  box(board, inks[INK.white]!, 2.44, 1.24, 0.08, 0, 1.13, 0);
  [INK.gold, INK.bloom, INK.mint, INK.sea, INK.gold].forEach((ink, i) => box(board, inks[ink]!, 0.24, 0.24, 0.1, -0.9 + i * 0.42, 1.65 - (i % 2) * 0.4, 0));
  box(board, inks[INK.accent]!, 1.2, 0.06, 0.1, 0.3, 1.35, 0);
  box(board, inks[INK.ink]!, 0.8, 0.06, 0.1, 0.1, 1.25, 0);

  const [cx, cz] = COFFEE_MACHINE;
  box(root, inks[INK.woodDark]!, 0.9, 0.9, 1.5, cx, 0, cz);
  box(root, inks[INK.wood]!, 0.96, 0.06, 1.56, cx, 0.9, cz);
  box(root, inks[INK.ink]!, 0.5, 0.7, 0.55, cx - 0.1, 0.96, cz - 0.1);
  box(root, inks[INK.stone]!, 0.2, 0.1, 0.24, cx + 0.2, 1.32, cz - 0.1);
  box(root, inks[INK.mint]!, 0.04, 0.08, 0.08, cx + 0.16, 1.5, cz + 0.08);
  box(root, inks[INK.white]!, 0.12, 0.14, 0.12, cx + 0.24, 0.96, cz - 0.1);
  box(root, inks[INK.accent]!, 0.12, 0.12, 0.12, cx + 0.1, 0.96, cz + 0.45);
  box(root, inks[INK.stoneLight]!, 0.44, 0.9, 0.44, cx, 0, 6.1);
  box(root, inks[INK.sea]!, 0.34, 0.46, 0.34, cx, 0.9, 6.1);

  const [tx, tz] = MEETING_TABLE;
  for (const sx of [-1, 1]) box(root, inks[INK.woodDark]!, 0.16, 0.7, 0.6, tx + sx * 1.1, 0, tz);
  box(root, inks[INK.wood]!, 3.0, 0.1, 1.5, tx, 0.7, tz);
  box(root, inks[INK.paper]!, 0.3, 0.02, 0.4, tx - 0.6, 0.8, tz + 0.2);
  box(root, inks[INK.paper]!, 0.3, 0.02, 0.4, tx + 0.7, 0.8, tz - 0.1);
  box(root, inks[INK.gold]!, 0.12, 0.12, 0.12, tx, 0.8, tz);
  for (const spot of SHARED_SPOTS.filter((s) => s.kind === "meeting")) chair(root, inks, spot.at, spot.face, INK.sea);

  for (const [x, z] of [[-4.6, -6.5], [-3.4, -6.5], [3.4, -6.5], [9.4, -6.5], [9.4, 6.5], [-9.4, -1.6]] as Point[]) plant(root, inks, x, z);

  const tree = placed(root, 12.1, 5.2, 0);
  box(tree, inks[INK.woodDark]!, 0.4, 1.6, 0.4, 0, 0, 0);
  box(tree, inks[INK.leaf0]!, 2.0, 1.1, 2.0, 0, 1.2, 0);
  box(tree, inks[INK.leaf1]!, 1.6, 0.9, 1.6, 0.1, 2.1, 0.1);
  box(tree, inks[INK.leaf2]!, 0.9, 0.6, 0.9, -0.1, 2.9, 0.2);
  box(tree, inks[INK.leaf1]!, 0.8, 0.7, 0.8, 0.9, 1.5, 0.6);
  for (const [x, y, z] of [[0.7, 1.9, 0.85], [-0.6, 2.4, 0.7], [0.3, 3.0, 0.6], [-0.95, 1.5, 0.4]]) box(tree, inks[INK.bloom]!, 0.16, 0.16, 0.16, x!, y!, z!);
  const bench = placed(root, 11.9, 2.6, -Math.PI / 2);
  box(bench, inks[INK.inkSoft]!, 0.1, 0.4, 0.4, -0.6, 0, 0);
  box(bench, inks[INK.inkSoft]!, 0.1, 0.4, 0.4, 0.6, 0, 0);
  box(bench, inks[INK.wood]!, 1.5, 0.1, 0.5, 0, 0.4, 0);
  box(bench, inks[INK.wood]!, 1.5, 0.4, 0.08, 0, 0.5, -0.22);
  box(root, inks[INK.leaf1]!, 3.2, 0.12, 6.2, 11.9, -0.1, 4.2);
  box(root, inks[INK.woodDark]!, 3.2, 1.5, 6.2, 11.9, -1.6, 4.2);

  for (const [x, z] of LAMPS) {
    const lamp = placed(root, x, z, 0);
    box(lamp, inks[INK.inkSoft]!, 0.36, 0.06, 0.36, 0, 0, 0);
    box(lamp, inks[INK.inkSoft]!, 0.06, 1.6, 0.06, 0, 0, 0);
    box(lamp, bulbs, 0.44, 0.32, 0.44, 0, 1.6, 0).castShadow = false;
  }
}

export function buildOffice(inks: Inks): Office {
  const root = new Group();
  const code = codeTexture();
  const screenGeometry = new PlaneGeometry(0.74, 0.44);
  const screens: MeshBasicMaterial[] = [];
  const bulbs = new MeshBasicMaterial();
  shell(root, inks);
  for (const d of [CEO_DESK, ...DESKS]) {
    const map = code.clone();
    map.offset.y = screens.length * 6 / CODE_ROWS;
    const screen = new MeshBasicMaterial({ map });
    screens.push(screen);
    desk(root, inks, d, screenGeometry, screen, d === CEO_DESK);
  }
  furnish(root, inks, bulbs);

  const lamps = LAMPS.map(([x, z]) => {
    const light = new PointLight(0xffffff, 0, 7, 1.4);
    light.position.set(x, 1.6, z);
    root.add(light);
    return light;
  });

  const glows = [CEO_DESK, ...DESKS].map((d) => {
    const light = new PointLight(0xffffff, 0, 2.8, 1.6);
    light.position.set(d.x, 1.2, d.z + d.facing * 0.3);
    root.add(light);
    return light;
  });

  const steamGeometry = new BufferGeometry();
  steamGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(STEAM * 3), 3));
  const steam = new PointsMaterial({ size: 1, sizeAttenuation: false });
  const puffs = new Points(steamGeometry, steam);
  puffs.frustumCulled = false;
  root.add(puffs);
  const [cx, cz] = COFFEE_MACHINE;

  return {
    root,
    screens,
    lamps,
    glows,
    bulbs,
    steam,
    update(time) {
      screens.forEach((screen, i) => {
        screen.map!.offset.y = (Math.floor(time * (2 + (i % 3)) + i * 5) * 2) / CODE_ROWS;
      });
      const position = steamGeometry.attributes.position!;
      for (let i = 0; i < STEAM; i++) {
        const life = (time * 0.45 + i / STEAM) % 1;
        position.setXYZ(i, cx + 0.24 + Math.sin(life * 9 + i) * 0.08, 1.15 + life * 0.9, cz - 0.1 + Math.cos(life * 7 + i) * 0.06);
      }
      position.needsUpdate = true;
    },
    dispose() {
      steamGeometry.dispose();
      screens.forEach((screen) => {
        screen.map!.dispose();
        screen.dispose();
      });
      code.dispose();
      screenGeometry.dispose();
      bulbs.dispose();
      steam.dispose();
      [...lamps, ...glows].forEach((light) => light.dispose());
    },
  };
}
