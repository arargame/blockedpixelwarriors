import * as THREE from 'three';

const VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute vec4 iColor;
  attribute float iRot;
  attribute vec3 iDir;
  varying vec2 vUv;
  varying vec4 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    vec3 dirView = (modelViewMatrix * vec4(iDir, 0.0)).xyz;
    float dl = length(dirView.xy);
    // Stretched billboards align their V axis with the projected velocity.
    vec2 axisY = dl > 1e-5 ? dirView.xy / dl : vec2(-sin(iRot), cos(iRot));
    vec2 axisX = vec2(axisY.y, -axisY.x);
    vec2 corner = position.xy * iSize;
    mvPosition.xy += axisX * corner.x + axisY * corner.y;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec4 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(map, vUv);
    vec4 c = t * vColor;
    if (c.a < 0.003) discard;
    if (uAdditive > 0.5) {
      // Premultiplied additive: the texture's white core stays hot, edges take the tint.
      gl_FragColor = vec4(c.rgb * c.a, c.a);
    } else {
      gl_FragColor = c;
    }
    #include <fog_fragment>
  }
`;

/**
 * GPU-instanced camera-facing quads. Each instance has position, size, RGBA tint,
 * rotation and an optional stretch direction. Used by particles, clouds and projectiles.
 */
export class BillboardBatch {
  /**
   * @param {THREE.Texture} map
   * @param {number} capacity
   * @param {{ additive?: boolean, fog?: boolean, depthWrite?: boolean, anchorBottom?: boolean, anchorTop?: boolean, renderOrder?: number }} [options]
   */
  constructor(map, capacity, options = {}) {
    this.capacity = capacity;
    const quad = new THREE.PlaneGeometry(1, 1);
    if (options.anchorTop) quad.translate(0, -0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));

    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity * 2);
    this.colors = new Float32Array(capacity * 4);
    this.rotations = new Float32Array(capacity);
    this.directions = new Float32Array(capacity * 3);

    this.attrPos = new THREE.InstancedBufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.attrSize = new THREE.InstancedBufferAttribute(this.sizes, 2).setUsage(THREE.DynamicDrawUsage);
    this.attrColor = new THREE.InstancedBufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrRot = new THREE.InstancedBufferAttribute(this.rotations, 1).setUsage(THREE.DynamicDrawUsage);
    this.attrDir = new THREE.InstancedBufferAttribute(this.directions, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iPos', this.attrPos);
    geometry.setAttribute('iSize', this.attrSize);
    geometry.setAttribute('iColor', this.attrColor);
    geometry.setAttribute('iRot', this.attrRot);
    geometry.setAttribute('iDir', this.attrDir);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    const additive = !!options.additive;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: map }, uAdditive: { value: additive ? 1 : 0 } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: options.depthWrite ?? false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      fog: options.fog ?? false,
    });
    if (additive) {
      this.material.blendSrc = THREE.OneFactor;
      this.material.blendDst = THREE.OneFactor;
      this.material.blendEquation = THREE.AddEquation;
    }
    this.material.uniforms.map.value = map;

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 10;
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  /**
   * Appends one billboard for this frame.
   * @returns {boolean} false when the batch is full
   */
  push(x, y, z, width, height, r, g, b, a, rotation = 0, dx = 0, dy = 0, dz = 0) {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.sizes[i * 2] = width;
    this.sizes[i * 2 + 1] = height;
    this.colors[i * 4] = r;
    this.colors[i * 4 + 1] = g;
    this.colors[i * 4 + 2] = b;
    this.colors[i * 4 + 3] = a;
    this.rotations[i] = rotation;
    this.directions[i * 3] = dx;
    this.directions[i * 3 + 1] = dy;
    this.directions[i * 3 + 2] = dz;
    return true;
  }

  end() {
    this.geometry.instanceCount = this.count;
    if (this.count === 0) return;
    for (const attr of [this.attrPos, this.attrSize, this.attrColor, this.attrRot, this.attrDir]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}
