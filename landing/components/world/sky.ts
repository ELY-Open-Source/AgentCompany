import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { INK, type DayPart } from "../../lib/palette";

const ORB: Record<DayPart, [number, number]> = { dawn: [0.16, 0.44], day: [0.18, 0.8], dusk: [0.84, 0.4], night: [0.8, 0.8] };

/** Screen-space backdrop: banded sky, sun or moon, drifting clouds, stars and a two-layer skyline with lit windows. */
export function createSky(): Mesh<PlaneGeometry, ShaderMaterial> {
  const colour = () => ({ value: new Color() });
  const material = new ShaderMaterial({
    uniforms: {
      sky0: colour(), sky1: colour(), sky2: colour(), sky3: colour(), orb: colour(), star: colour(),
      cloud: colour(), far: colour(), near: colour(), lit: colour(),
      night: { value: 0 }, moon: { value: 0 }, time: { value: 0 },
      resolution: { value: new Vector2(320, 180) }, orbPos: { value: new Vector2() }, offset: { value: new Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sky0, sky1, sky2, sky3, orb, star, cloud, far, near, lit;
      uniform float night, moon, time;
      uniform vec2 resolution, orbPos, offset;

      const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      vec3 band(vec3 low, vec3 high, float t, float threshold) {
        return clamp((t - 0.5) * 2.2 + 0.5, 0.0, 1.0) > threshold ? high : low;
      }

      bool cloudAt(vec2 px, float k) {
        float span = resolution.x + 80.0;
        vec2 c = vec2(mod(k * 137.0 + time * (1.5 + k * 0.6), span) - 40.0, resolution.y * (0.6 + 0.09 * k));
        if (px.y < c.y - 1.0) return false;
        vec2 d = px - c;
        return length(d * vec2(0.55, 1.0)) < 5.0 + k || length(d - vec2(8.0, -1.0)) < 4.0 || length(d + vec2(9.0, 1.0)) < 3.5;
      }

      void main() {
        vec2 px = floor(gl_FragCoord.xy);
        float v = px.y / resolution.y;
        ivec2 cell4 = ivec2(mod(px, 4.0));
        float threshold = (BAYER[cell4.y * 4 + cell4.x] + 0.5) / 16.0;
        vec3 c = v > 0.74 ? band(sky1, sky0, (v - 0.74) / 0.26, threshold)
          : v > 0.48 ? band(sky2, sky1, (v - 0.48) / 0.26, threshold)
          : band(sky3, sky2, clamp((v - 0.2) / 0.28, 0.0, 1.0), threshold);

        float h = hash(px + floor(offset * 0.3));
        if (moon > 0.5 && v > 0.42 && h > 0.996) c = mix(c, star, step(0.35, fract(h * 97.0 + time * 0.4)));

        for (float k = 0.0; k < 3.0; k++) if (cloudAt(px + floor(offset * 0.25), k)) c = cloud;

        vec2 o = orbPos * resolution + floor(offset * 0.2);
        float d = length(px + 0.5 - o);
        if (moon > 0.5) {
          if (d < 7.0 && length(px + 0.5 - o - vec2(3.0, 2.0)) > 6.0) c = orb;
        } else {
          if (d < 14.0 && threshold < 0.3) c = orb;
          if (d < 9.0) c = orb;
        }

        float unit = min(resolution.y, resolution.x * 0.9);
        float fx = px.x + floor(offset.x * 0.35);
        float fid = floor(fx / 9.0);
        if (px.y < unit * (0.2 + hash(vec2(fid, 3.0)) * 0.16)) {
          c = far;
          vec2 cell = vec2(mod(fx, 9.0), mod(px.y, 5.0));
          if (night > 0.5 && cell.x > 2.0 && cell.x < 7.0 && cell.y == 2.0 && hash(vec2(fid, floor(px.y / 5.0))) > 0.7) c = lit;
        }
        float nx = px.x + floor(offset.x * 0.6);
        float nid = floor(nx / 13.0);
        float top = unit * (0.08 + hash(vec2(nid, 9.0)) * 0.15);
        if (px.y < top) {
          c = near;
          vec2 cell = vec2(mod(nx, 13.0), mod(px.y, 4.0));
          bool window = cell.x > 1.0 && cell.x < 11.0 && mod(cell.x, 3.0) == 2.0 && cell.y == 1.0 && px.y < top - 2.0;
          if (window) c = night > 0.5 && hash(vec2(nx, floor(px.y / 4.0))) > 0.45 ? lit : mix(near, sky3, 0.35);
        }
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function setSkyPalette(material: ShaderMaterial, colours: string[], part: DayPart): void {
  const u = material.uniforms;
  const set = (name: string, index: number) => (u[name]!.value as Color).set(colours[index]!);
  set("sky0", INK.sky0); set("sky1", INK.sky1); set("sky2", INK.sky2); set("sky3", INK.sky3);
  set("orb", INK.sun); set("star", INK.star); set("cloud", INK.cloud); set("lit", INK.gold);
  (u.far!.value as Color).set(colours[INK.sky1]!).lerp(new Color(colours[INK.stone]!), 0.5);
  (u.near!.value as Color).set(colours[INK.inkSoft]!).lerp(new Color(colours[INK.sky0]!), 0.3);
  u.night!.value = part === "night" || part === "dusk" ? 1 : 0;
  u.moon!.value = part === "night" ? 1 : 0;
  (u.orbPos!.value as Vector2).set(...ORB[part]);
}
