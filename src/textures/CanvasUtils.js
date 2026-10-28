import * as THREE from 'three';

/** Creates an HTML canvas (works in browsers and the headless capture tool). */
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Wraps a canvas into a Three texture.
 * @param {HTMLCanvasElement} canvas
 * @param {{ srgb?: boolean, repeat?: boolean, mipmaps?: boolean, anisotropy?: number }} options
 */
export function canvasToTexture(canvas, { srgb = true, repeat = false, mipmaps = true, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Writes a per-pixel generator into a canvas.
 * @param {number} width
 * @param {number} height
 * @param {(x:number, y:number, out:Float32Array) => void} shader writes RGBA (0..1) into out
 */
export function paintPixels(width, height, shader) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const out = new Float32Array(4);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[0] = out[1] = out[2] = 0;
      out[3] = 1;
      shader(x, y, out);
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, out[0] * 255));
      data[i + 1] = Math.max(0, Math.min(255, out[1] * 255));
      data[i + 2] = Math.max(0, Math.min(255, out[2] * 255));
      data[i + 3] = Math.max(0, Math.min(255, out[3] * 255));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Converts a height field into a tangent-space normal map canvas (OpenGL convention, +Y up).
 * @param {Float32Array} heights row-major, row 0 = top of image
 */
export function heightToNormalCanvas(heights, width, height, strength = 2, wrap = true) {
  const sample = (x, y) => {
    if (wrap) {
      x = (x + width) % width;
      y = (y + height) % height;
    } else {
      x = Math.max(0, Math.min(width - 1, x));
      y = Math.max(0, Math.min(height - 1, y));
    }
    return heights[y * width + x];
  };
  return paintPixels(width, height, (x, y, out) => {
    const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
    const dy = (sample(x, y - 1) - sample(x, y + 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    out[0] = (-dx / len) * 0.5 + 0.5;
    out[1] = (-dy / len) * 0.5 + 0.5;
    out[2] = (1 / len) * 0.5 + 0.5;
    out[3] = 1;
  });
}
