import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT } from '../config.js';
import { seededRandom } from './textures.js';

const SHIRTS = [0xff6b4a, 0x2dd4bf, 0xffd166, 0xf4f4f4, 0x3b82f6, 0xef476f, 0x06d6a0, 0x8b5cf6, 0xf97316, 0x0ea5e9];
const SKINS = [0xf1c9a5, 0xe0ac86, 0xc68a5e, 0x8d5a3b, 0x5c3a24];

function part(geometry, color, { shirt = 0, arm = 0 } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('shirt', new THREE.BufferAttribute(new Float32Array(n).fill(shirt), 1));
  g.setAttribute('arm', new THREE.BufferAttribute(new Float32Array(n).fill(arm), 1));
  return g;
}

/** Torcedor sentado, low-poly. Camisa recebe a cor da instância; braços sobem na comemoração. */
function spectatorGeometry(skin) {
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.34, 0.42, 0.22).translate(0, 0.21, 0), 0xffffff, { shirt: 1 }),
    part(new THREE.IcosahedronGeometry(0.11, 1).translate(0, 0.54, 0), skin),
    part(new THREE.BoxGeometry(0.3, 0.12, 0.36).translate(0, -0.02, -0.14), 0x2b3442),
    part(new THREE.BoxGeometry(0.09, 0.32, 0.09).translate(-0.21, 0.2, -0.02), skin, { arm: -1 }),
    part(new THREE.BoxGeometry(0.09, 0.32, 0.09).translate(0.21, 0.2, -0.02), skin, { arm: 1 }),
  ]);
}

/**
 * Torcida nas arquibancadas: ~200 pessoas em poucos draw calls (uma InstancedMesh por tom de pele).
 * A animação é toda no vertex shader: balanço leve sempre, pulos e braços para cima quando empolgada.
 */
export class Crowd {
  constructor(scene) {
    this.excitement = 0.15;
    this.target = 0.15;
    this.uniforms = { uTime: { value: 0 }, uExcite: { value: 0.15 } };
    const rand = seededRandom(5);

    // Lugares nos 5 degraus das 3 arquibancadas (mesmas posições de Scenery).
    const stands = [
      { x: COURT.halfWidth + 6.4, z: 0, rot: Math.PI / 2 },
      { x: 0, z: -COURT.halfLength - 6.6, rot: Math.PI },
      { x: 0, z: COURT.halfLength + 6.6, rot: 0 },
    ];
    const seats = [];
    for (const s of stands) {
      const m = new THREE.Matrix4().makeRotationY(s.rot).setPosition(s.x, 0, s.z);
      for (let row = 0; row < 5; row++) {
        for (let i = 0; i < 18; i++) {
          if (rand() < 0.28) continue;
          const local = new THREE.Vector3(-5.4 + i * 0.63 + (rand() - 0.5) * 0.12, 0.48 + row * 0.42, row * 0.62 + 0.02);
          seats.push({ pos: local.applyMatrix4(m), rot: s.rot + (rand() - 0.5) * 0.4 });
        }
      }
    }

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uExcite = this.uniforms.uExcite;
      shader.vertexShader = `attribute float shirt;\nattribute float arm;\nuniform float uTime;\nuniform float uExcite;\n${shader.vertexShader}`
        .replace('#include <color_vertex>', `
          vColor = vec3(1.0);
          #ifdef USE_COLOR
            vColor *= color;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vColor = mix(vColor, vColor * instanceColor, shirt);
          #endif
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
          float idle = sin(uTime * 1.3 + phase) * 0.015;
          float jumpy = max(0.0, sin(uTime * 9.0 + phase * 3.0)) * 0.12 * smoothstep(0.45, 1.0, uExcite);
          transformed.y += idle + jumpy;
          // Braços sobem por cima da cabeça quando a torcida explode.
          float raise = smoothstep(0.35, 0.9, uExcite) * abs(arm);
          transformed.y += raise * (0.34 + sin(uTime * 7.0 + phase) * 0.05);
          transformed.x += raise * arm * 0.03;
        `);
    };

    const groups = SKINS.map(() => []);
    for (const seat of seats) groups[Math.floor(rand() * SKINS.length)].push(seat);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    groups.forEach((list, gi) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(spectatorGeometry(SKINS[gi]), material, list.length);
      const col = new THREE.Color();
      list.forEach((seat, i) => {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, seat.rot);
        const s = 0.9 + rand() * 0.2;
        m.compose(seat.pos, q, one.clone().multiplyScalar(s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
      });
      mesh.computeBoundingSphere();
      scene.add(mesh);
    });
    this.count = seats.length;
  }

  /** Explosão da torcida (0..1), que volta ao murmúrio sozinha. */
  cheer(intensity = 1) {
    this.target = Math.max(this.target, 0.4 + intensity * 0.6);
  }

  update(dt, time) {
    this.excitement += (this.target - this.excitement) * Math.min(1, dt * 4);
    this.target = Math.max(0.15, this.target - dt * 0.35);
    this.uniforms.uTime.value = time;
    this.uniforms.uExcite.value = this.excitement;
  }
}
