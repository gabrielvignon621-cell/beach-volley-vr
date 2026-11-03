import * as THREE from 'three';

const PER_BURST = 48;
const BURSTS = 8;
const COUNT = PER_BURST * BURSTS;

/**
 * Pool fixo de partículas de areia: um único Points, sem alocação durante o jogo.
 * Cada impacto reaproveita o bloco de partículas mais antigo.
 */
export class SandBurst {
  constructor(scene) {
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    this.life = new Float32Array(COUNT);
    this.maxLife = new Float32Array(COUNT).fill(1);
    this.sizes = new Float32Array(COUNT);
    this.alphas = new Float32Array(COUNT);
    this.next = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0xe8cf9e) },
        uScale: { value: 600 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          vAlpha = alpha;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(uColor, vAlpha * (1.0 - r * 4.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(position, intensity = 1) {
    const k = THREE.MathUtils.clamp(intensity, 0.2, 2);
    const start = this.next * PER_BURST;
    this.next = (this.next + 1) % BURSTS;
    for (let i = start; i < start + PER_BURST; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = (0.6 + Math.random() * 1.6) * k;
      this.positions[i * 3] = position.x + Math.cos(a) * 0.08;
      this.positions[i * 3 + 1] = 0.03;
      this.positions[i * 3 + 2] = position.z + Math.sin(a) * 0.08;
      this.velocities[i * 3] = Math.cos(a) * spread;
      this.velocities[i * 3 + 1] = (1.2 + Math.random() * 2.4) * k;
      this.velocities[i * 3 + 2] = Math.sin(a) * spread;
      this.maxLife[i] = 0.5 + Math.random() * 0.6;
      this.life[i] = this.maxLife[i];
      this.sizes[i] = 0.012 + Math.random() * 0.022;
    }
  }

  update(dt) {
    if (dt <= 0) return;
    let active = false;
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      active = true;
      this.life[i] -= dt;
      this.velocities[i * 3 + 1] -= 9.8 * dt;
      const drag = 1 - 2.2 * dt;
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 2] *= drag;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] = Math.max(0.005, this.positions[i * 3 + 1] + this.velocities[i * 3 + 1] * dt);
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.alphas[i] = Math.max(this.life[i] / this.maxLife[i], 0) * 0.9;
    }
    if (active || this.wasActive) {
      const attrs = this.points.geometry.attributes;
      attrs.position.needsUpdate = true;
      attrs.alpha.needsUpdate = true;
      attrs.size.needsUpdate = true;
    }
    this.wasActive = active;
  }
}
