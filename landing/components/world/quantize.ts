import { ShaderMaterial, Vector3, type Texture } from "three";
import { PALETTE_SIZE } from "../../lib/palette";

/** Snaps every scene pixel to the two nearest palette colours, choosing between them with a 4x4 Bayer matrix. */
export function createQuantizeMaterial(scene: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      tScene: { value: scene },
      palette: { value: Array.from({ length: PALETTE_SIZE }, () => new Vector3()) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec3 palette[${PALETTE_SIZE}];
      varying vec2 vUv;
      const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
      const vec3 WEIGHT = vec3(0.55, 0.75, 0.4);

      vec3 toSrgb(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      void main() {
        vec3 colour = toSrgb(texture2D(tScene, vUv).rgb);
        float best = 1e9;
        float next = 1e9;
        vec3 first = palette[0];
        vec3 second = palette[0];
        for (int i = 0; i < ${PALETTE_SIZE}; i++) {
          vec3 delta = (palette[i] - colour) * WEIGHT;
          float distance = dot(delta, delta);
          if (distance < best) {
            next = best; second = first;
            best = distance; first = palette[i];
          } else if (distance < next) {
            next = distance; second = palette[i];
          }
        }
        vec3 span = second - first;
        float along = clamp(dot(colour - first, span) / max(dot(span, span), 1e-5) * 2.0 - 0.45, 0.0, 1.0);
        ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
        float threshold = (BAYER[cell.y * 4 + cell.x] + 0.5) / 16.0;
        gl_FragColor = vec4(along > threshold ? second : first, 1.0);
      }
    `,
  });
}

export function setQuantizePalette(material: ShaderMaterial, colours: string[]): void {
  const slots = material.uniforms.palette!.value as Vector3[];
  colours.forEach((hex, index) => {
    const value = Number.parseInt(hex.slice(1), 16);
    slots[index]!.set(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
  });
}
