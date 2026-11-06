/**
 * Rain falling into the coffee mug: rings spreading over the coffee's surface, a few at a time,
 * each from a drop hitting a hashed spot - all in the coffee material's fragment shader (no
 * geometry, no textures, no CPU work beyond one time uniform). The rings bend the surface normal,
 * so the lamp's highlight and the reflections wobble across them.
 *
 *   rippleCoffee(material, { radius })  patches a MeshStandardMaterial (the mug's Coffee)
 *   COFFEE_TIME.value += dt              moves every patched coffee
 *
 * `radius` is the coffee disc's radius in the mesh's own units (x-z plane, y up).
 */
export const COFFEE_TIME = { value: 0 };

const DROPS = 6;

export function rippleCoffee(material, { radius = 1.28 } = {}) {
  if (material.userData.coffeeRipples) return material;
  material.userData.coffeeRipples = true;
  material.roughness = 0.08;
  material.metalness = 0;
  // Dark coffee: the ripples catch the lamp, not much of the cold sky.
  material.envMapIntensity = 0.7;
  material.color.setHex(0x1a0d06);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCoffeeTime = COFFEE_TIME;
    shader.uniforms.uCoffeeR = { value: radius };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vCoffee;
        varying vec3 vCoffeeTx;
        varying vec3 vCoffeeTz;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCoffee = position.xz;
        vCoffeeTx = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
        vCoffeeTz = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uCoffeeTime;
        uniform float uCoffeeR;
        varying vec2 vCoffee;
        varying vec3 vCoffeeTx;
        varying vec3 vCoffeeTz;
        float coffeeHash(float n) { return fract(sin(n * 91.345) * 47453.21); }
        // Gradient of the ripple height field at p (sum of expanding, fading rings).
        vec2 coffeeRipples(vec2 p) {
          vec2 g = vec2(0.0);
          for (int i = 0; i < ${DROPS}; i++) {
            float fi = float(i);
            float rate = 0.55 + coffeeHash(fi * 3.7) * 0.5;
            float cyc = uCoffeeTime * rate + coffeeHash(fi * 1.3);
            float n = floor(cyc);
            float t = fract(cyc);
            float a = coffeeHash(n * 7.1 + fi * 13.0) * 6.2832;
            float r = sqrt(coffeeHash(n * 3.3 + fi * 5.0)) * uCoffeeR * 0.85;
            vec2 c = vec2(cos(a), sin(a)) * r;
            vec2 d = p - c;
            float dist = length(d) + 1e-4;
            float front = t * uCoffeeR * 0.9;
            float k = 26.0 / uCoffeeR;
            float x = dist - front;
            // A short wave train just behind the front, fading as it spreads.
            float env = exp(-x * x * k * 0.9) * (1.0 - t) * (1.0 - t);
            g += d / dist * cos(x * k) * env;
          }
          // Waves die out at the mug wall.
          return g * smoothstep(uCoffeeR, uCoffeeR * 0.8, length(p));
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 rg = coffeeRipples(vCoffee) * 0.45;
          normal = normalize(normal - vCoffeeTx * rg.x - vCoffeeTz * rg.y);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'coffeeRipples';
  material.needsUpdate = true;
  return material;
}
