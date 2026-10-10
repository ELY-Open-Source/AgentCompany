import { BoxGeometry, Mesh, MeshLambertMaterial, type Material, type Object3D } from "three";
import { PALETTE_SIZE } from "../../lib/palette";

export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** One Lambert material per palette index, recoloured in place whenever the palette rotates. */
export type Inks = MeshLambertMaterial[];

export function createInks(): Inks {
  return Array.from({ length: PALETTE_SIZE }, () => new MeshLambertMaterial());
}

export function paintInks(inks: Inks, colours: string[]): void {
  inks.forEach((material, index) => material.color.set(colours[index]!));
}

/** Adds a w×h×d box whose bottom sits at y. */
export function box(parent: Object3D, material: Material, w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(UNIT_BOX, material);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
