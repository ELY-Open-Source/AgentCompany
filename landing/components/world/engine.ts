import {
  BasicShadowMap, Camera, HalfFloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, Vector2,
  WebGLRenderer, WebGLRenderTarget,
} from "three";
import type { DayPart } from "../../lib/palette";
import { createAgents } from "./agents";
import { applyLighting, createLights } from "./lighting";
import { buildOffice } from "./office";
import { createQuantizeMaterial, setQuantizePalette } from "./quantize";
import { createSky, setSkyPalette } from "./sky";
import { UNIT_BOX, createInks, paintInks } from "./voxel";

export interface World {
  setPalette(colours: string[], part: DayPart): void;
  resize(width: number, height: number): void;
  setPointer(x: number, y: number): void;
  setScroll(progress: number): void;
  setFocusRight(right: boolean): void;
  setRunning(running: boolean): void;
  render(): void;
  dispose(): void;
}

const ART_PIXELS = 320 * 180;
const MAX_DPR = 2;
const TARGET = { x: 1.6, y: 0.2, z: 0.4 };
const RIGHT_SHARE = 0.55;

/** Real-time office diorama drawn at ~320×180, then palette-quantized onto the canvas. */
export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = BasicShadowMap;

  const target = new WebGLRenderTarget(320, 180, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter });
  const quantize = createQuantizeMaterial(target.texture);
  const post = new Scene();
  const postQuad = new Mesh(new PlaneGeometry(2, 2), quantize);
  postQuad.frustumCulled = false;
  post.add(postQuad);
  const postCamera = new Camera();

  const scene = new Scene();
  const inks = createInks();
  const office = buildOffice(inks);
  const agents = createAgents(inks);
  const lights = createLights();
  const sky = createSky();
  scene.add(sky, office.root, agents.root, lights.sun, lights.sun.target, lights.sky);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 120);
  const pointer = new Vector2();
  const eased = new Vector2();
  let scroll = 0;
  let focusRight = false;
  let aspect = 16 / 9;
  let time = 0;
  let last = 0;
  let frame = 0;

  function place(): void {
    eased.lerp(pointer, 0.06);
    const yaw = Math.PI / 4 + Math.sin(time * 0.08) * 0.16 + eased.x * 0.12;
    const pitch = 0.56 + eased.y * 0.05;
    camera.position.set(
      TARGET.x + Math.sin(yaw) * Math.cos(pitch) * 50,
      TARGET.y + Math.sin(pitch) * 50,
      TARGET.z + Math.cos(yaw) * Math.cos(pitch) * 50,
    );
    camera.lookAt(TARGET.x, TARGET.y, TARGET.z);
    const share = focusRight ? RIGHT_SHARE : 1;
    const half = Math.max(10.6, 13 / (aspect * share)) / (1 + scroll * 0.18);
    const width = half * aspect * 2;
    const centre = focusRight ? 1 - share / 2 : 0.5;
    camera.top = half;
    camera.bottom = -half;
    camera.left = -width * centre;
    camera.right = width * (1 - centre);
    camera.updateProjectionMatrix();
    (sky.material.uniforms.offset!.value as Vector2).set(-eased.x * 14 - Math.sin(time * 0.08) * 16, 0);
    sky.material.uniforms.time!.value = time;
  }

  function render(): void {
    place();
    office.update(time);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post, postCamera);
  }

  function tick(now: number): void {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    time += dt;
    agents.update(dt, time);
    render();
    frame = requestAnimationFrame(tick);
  }

  return {
    setPalette(colours, part) {
      paintInks(inks, colours);
      setSkyPalette(sky.material, colours, part);
      setQuantizePalette(quantize, colours);
      applyLighting(lights, office, colours, part);
    },
    resize(width, height) {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const deviceWidth = width * dpr;
      const deviceHeight = height * dpr;
      const scale = Math.max(1, Math.round(Math.sqrt((deviceWidth * deviceHeight) / ART_PIXELS)));
      const artWidth = Math.ceil(deviceWidth / scale);
      const artHeight = Math.ceil(deviceHeight / scale);
      aspect = artWidth / artHeight;
      renderer.setSize(artWidth, artHeight, false);
      target.setSize(artWidth, artHeight);
      (sky.material.uniforms.resolution!.value as Vector2).set(artWidth, artHeight);
      canvas.style.width = `${(artWidth * scale) / dpr}px`;
      canvas.style.height = `${(artHeight * scale) / dpr}px`;
    },
    setPointer(x, y) {
      pointer.set(x, y);
    },
    setScroll(progress) {
      scroll = progress;
    },
    setFocusRight(right) {
      focusRight = right;
    },
    setRunning(running) {
      cancelAnimationFrame(frame);
      last = 0;
      if (running) frame = requestAnimationFrame(tick);
    },
    render() {
      eased.copy(pointer);
      render();
    },
    dispose() {
      cancelAnimationFrame(frame);
      office.dispose();
      inks.forEach((material) => material.dispose());
      UNIT_BOX.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      postQuad.geometry.dispose();
      quantize.dispose();
      lights.sun.dispose();
      lights.sky.dispose();
      target.dispose();
      renderer.dispose();
    },
  };
}
