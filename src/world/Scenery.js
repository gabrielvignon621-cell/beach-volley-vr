import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT, WORLD } from '../config.js';
import { sandHeight } from './Sand.js';
import { createCloudAtlas, fbm, seededRandom } from './textures.js';

/* Utilitários de geometria com cor por vértice e peso de balanço (sway). */

function withAttributes(geometry, color, sway = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n).fill(sway), 1));
  return g;
}

function rawGeometry(positions, colors, sway) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  return g;
}

/** Palmeira low-poly: tronco curvo anelado, 11 folhas arqueadas e cocos. */
function buildPalmGeometry(rand) {
  const parts = [];
  const height = 6.6;
  const lean = 1.3;
  const rings = 18;
  const radial = 7;
  const spine = (t) => new THREE.Vector3(lean * t * t, height * t, 0);

  // Tronco
  {
    const pos = [];
    const col = [];
    const sw = [];
    const ringPts = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const c = spine(t);
      const r = (0.21 - 0.08 * t) * (i % 2 ? 1 : 1.1);
      const pts = [];
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r));
      }
      ringPts.push({ pts, t, shade: i % 2 ? 0.82 : 1 });
    }
    const base = new THREE.Color(0x8a6a4a);
    for (let i = 0; i < rings; i++) {
      const A = ringPts[i];
      const B = ringPts[i + 1];
      const cc = base.clone().multiplyScalar(A.shade * (0.85 + A.t * 0.2));
      for (let j = 0; j < radial; j++) {
        const j2 = (j + 1) % radial;
        const quad = [A.pts[j], B.pts[j], A.pts[j2], A.pts[j2], B.pts[j], B.pts[j2]];
        for (const p of quad) {
          pos.push(p.x, p.y, p.z);
          col.push(cc.r, cc.g, cc.b);
          sw.push(Math.pow(p.y / height, 2) * 0.35);
        }
      }
    }
    parts.push(rawGeometry(pos, col, sw));
  }

  // Folhas
  const top = spine(1);
  const fronds = 11;
  const dark = new THREE.Color(0x2c6a2a);
  const light = new THREE.Color(0x86b94a);
  for (let f = 0; f < fronds; f++) {
    const az = (f / fronds) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const elev0 = 0.55 + rand() * 0.35;
    const length = 2.9 + rand() * 0.8;
    const droop = 1.9 + rand() * 0.5;
    const segs = 9;
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    const spinePts = [];
    const p = top.clone();
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      spinePts.push({ p: p.clone(), t });
      const e = elev0 - t * droop;
      const step = length / segs;
      p.add(new THREE.Vector3(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)).multiplyScalar(step));
    }
    const pos = [];
    const col = [];
    const sw = [];
    const tint = 0.9 + rand() * 0.2;
    const edgeAt = (s, dir) => {
      const { p: sp, t } = spinePts[s];
      const w = 0.62 * Math.sin(Math.PI * Math.min(t * 1.1, 1)) * (1 - 0.25 * t);
      return sp.clone().addScaledVector(side, w * dir).add(new THREE.Vector3(0, -w * 0.38, 0));
    };
    for (let s = 0; s < segs; s++) {
      const a = spinePts[s];
      const b = spinePts[s + 1];
      const cA = dark.clone().lerp(light, a.t).multiplyScalar(tint);
      const cB = dark.clone().lerp(light, b.t).multiplyScalar(tint);
      for (const dir of [-1, 1]) {
        const ea = edgeAt(s, dir);
        const eb = edgeAt(s + 1, dir);
        const tri = [
          [a.p, cA, a.t], [ea, cA, a.t], [b.p, cB, b.t],
          [b.p, cB, b.t], [ea, cA, a.t], [eb, cB, b.t],
        ];
        for (const [v, c, t] of tri) {
          pos.push(v.x, v.y, v.z);
          col.push(c.r, c.g, c.b);
          sw.push(0.35 + t * 1.1);
        }
      }
    }
    parts.push(rawGeometry(pos, col, sw));
  }

  // Cocos
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const nut = new THREE.IcosahedronGeometry(0.13, 0).translate(top.x + Math.cos(a) * 0.2, top.y - 0.22, top.z + Math.sin(a) * 0.2);
    parts.push(withAttributes(nut, 0x5a3d22, 0.35));
  }

  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

function swayMaterial(timeUniform, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    side: THREE.DoubleSide,
    flatShading: true,
    ...options,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = `attribute float sway;\nuniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      #else
        float phase = 0.0;
      #endif
      float gust = sin(uTime * 1.1 + phase) * 0.6 + sin(uTime * 2.7 + phase * 1.7) * 0.25;
      transformed.x += gust * sway * 0.13;
      transformed.z += cos(uTime * 0.83 + phase) * sway * 0.08;
      transformed.y -= abs(gust) * sway * sway * 0.025;`,
    );
  };
  return material;
}

function buildPalms(scene, timeUniform) {
  const rand = seededRandom(7);
  const geometry = buildPalmGeometry(rand);
  const spots = [
    // Ao longo da praia, inclinadas para o mar.
    [-12.5, -22, -0.6], [-11.8, -9, -0.4], [-12.8, 3.5, -0.7], [-11.5, 15, -0.3], [-13, 27, -0.5],
    // Fundo do lado adversário.
    [-6, -24, 1.4], [4, -26, 2.6], [12, -21, 2.2], [20, -15, 3.1],
    // Atrás das arquibancadas e do jogador.
    [19, -2, 3.4], [18.5, 17, 2.8], [14, 22, 4.0], [3, 25, 4.6], [-6, 23, 5.2], [26, 20, 3.6], [28, -8, 2.9],
  ];
  // Bosque mais ao fundo, em terra firme: mesmo draw call (instancing).
  for (let i = 0; i < 46; i++) {
    const x = 32 + rand() * 70;
    const z = (rand() - 0.5) * 200;
    spots.push([x, z, rand() * Math.PI * 2]);
  }
  const mesh = new THREE.InstancedMesh(geometry, swayMaterial(timeUniform), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  spots.forEach(([x, z, rotY], i) => {
    const scale = 0.85 + rand() * 0.4;
    q.setFromEuler(new THREE.Euler(0, rotY + Math.PI, 0));
    s.setScalar(scale);
    m.compose(new THREE.Vector3(x, sandHeight(x, z) - 0.05, z), q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

/** Arquibancada de alumínio com 5 degraus de assentos. */
function buildBleacherGeometry(length) {
  const parts = [];
  const seat = new THREE.Color(0x1f6f8b);
  const seatAlt = new THREE.Color(0x2a9d8f);
  const metal = new THREE.Color(0xd5dbe1);
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const y = 0.45 + i * 0.42;
    const z = i * 0.62;
    parts.push(withAttributes(new THREE.BoxGeometry(length, 0.06, 0.38).translate(0, y, z), i % 2 ? seatAlt : seat));
    parts.push(withAttributes(new THREE.BoxGeometry(length, 0.035, 0.26).translate(0, y - 0.25, z - 0.3), metal));
    // Espelho do degrau: dá volume e esconde a estrutura por baixo.
    parts.push(withAttributes(new THREE.BoxGeometry(length, 0.42, 0.025).translate(0, y - 0.21, z + 0.19), metal.clone().multiplyScalar(0.78)));
  }
  const supports = Math.round(length / 2.4) + 1;
  for (let s = 0; s < supports; s++) {
    const x = -length / 2 + (s / (supports - 1)) * length;
    for (let i = 0; i < rows; i++) {
      const h = 0.45 + i * 0.42;
      parts.push(withAttributes(new THREE.BoxGeometry(0.06, h, 0.06).translate(x, h / 2, i * 0.62), metal));
    }
    const back = (rows - 1) * 0.62 + 0.25;
    const topY = 0.45 + (rows - 1) * 0.42 + 0.9;
    parts.push(withAttributes(new THREE.BoxGeometry(0.05, topY, 0.05).translate(x, topY / 2, back), metal));
  }
  const back = (rows - 1) * 0.62 + 0.25;
  const topY = 0.45 + (rows - 1) * 0.42 + 0.9;
  parts.push(withAttributes(new THREE.BoxGeometry(length, 0.05, 0.05).translate(0, topY, back), metal));
  parts.push(withAttributes(new THREE.BoxGeometry(length, 0.05, 0.05).translate(0, topY - 0.45, back), metal));
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

function buildBleachers(scene) {
  const geometry = buildBleacherGeometry(12);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
  // Arquibancada voltada para a quadra: frente em -Z local.
  const placements = [
    { x: COURT.halfWidth + 6.4, z: 0, rot: Math.PI / 2 },
    { x: 0, z: -COURT.halfLength - 6.6, rot: Math.PI },
    { x: 0, z: COURT.halfLength + 6.6, rot: 0 },
  ];
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const m = new THREE.Matrix4();
  placements.forEach((p, i) => {
    m.makeRotationY(p.rot).setPosition(p.x, 0, p.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

function buildUmbrellas(scene, rand) {
  const canopy = new THREE.ConeGeometry(1.25, 0.5, 12, 1, true).toNonIndexed();
  const n = canopy.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const a = new THREE.Color(0xff6b4a);
  const b = new THREE.Color(0xfff4e0);
  const p = canopy.attributes.position;
  for (let t = 0; t < n; t += 3) {
    const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
    const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
    const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12);
    const c = seg % 2 ? a : b;
    for (let k = 0; k < 3; k++) c.toArray(colors, (t + k) * 3);
  }
  canopy.deleteAttribute('uv');
  canopy.deleteAttribute('normal');
  canopy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  canopy.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n), 1));
  canopy.translate(0, 2.25, 0);
  const pole = withAttributes(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 6).translate(0, 1.15, 0), 0xf2f2f2);
  const geometry = mergeGeometries([canopy, pole]);
  geometry.computeVertexNormals();

  const spots = [[-10.5, -14], [-11, -4.5], [-10.2, 8.5], [-11.4, 20], [10, -16], [16, 13]];
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, flatShading: true }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    const tilt = new THREE.Euler((rand() - 0.5) * 0.25, rand() * Math.PI, (rand() - 0.5) * 0.25);
    m.makeRotationFromEuler(tilt).setPosition(x, sandHeight(x, z) - 0.15, z);
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

/** Ilhas no horizonte, em tons enevoados para dar profundidade. */
function buildIslands(scene) {
  const parts = [];
  const defs = [
    { x: -560, z: -260, sx: 130, sy: 20, sz: 60, seed: 1 },
    { x: -700, z: 140, sx: 200, sy: 30, sz: 80, seed: 2 },
    { x: -520, z: 400, sx: 80, sy: 14, sz: 45, seed: 3 },
  ];
  for (const d of defs) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const n = fbm(x * 2 + d.seed * 10, z * 2, { octaves: 3 });
      y = Math.max(y, -0.05) * (0.6 + n * 0.9);
      p.setXYZ(i, x * d.sx + d.x, y * d.sy + WORLD.waterLevel - 2, z * d.sz + d.z);
    }
    parts.push(g);
  }
  const geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x9fb7b8, emissive: 0x7f9ba6, emissiveIntensity: 0.45, roughness: 1, flatShading: true }),
  ));
}

/** Morros verdes no continente fecham o horizonte do lado oposto ao mar. */
function buildHills(scene, rand) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    const sx = 120 + rand() * 120;
    const sy = 18 + rand() * 22;
    const sz = 90 + rand() * 70;
    const cx = 420 + rand() * 120;
    const cz = -520 + i * 130 + (rand() - 0.5) * 40;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = Math.max(p.getY(k), -0.1);
      const z = p.getZ(k);
      const n = fbm(x * 1.7 + i * 3.1, z * 1.7, { octaves: 3 });
      p.setXYZ(k, x * sx + cx, y * sy * (0.7 + n * 0.6) - 4, z * sz + cz);
    }
    parts.push(g);
  }
  const geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x86a68f, emissive: 0x8fa9b8, emissiveIntensity: 0.25, roughness: 1, flatShading: true }),
  ));
}

/** Nuvens como cartões voltados ao centro, num único draw call. */
function buildClouds(scene, rand) {
  const atlas = createCloudAtlas();
  const parts = [];
  const count = 22;
  for (let i = 0; i < count; i++) {
    const az = rand() * Math.PI * 2;
    const r = 520 + rand() * 260;
    const w = 160 + rand() * 220;
    const h = w * (0.38 + rand() * 0.15);
    const y = 70 + rand() * 120;
    const g = new THREE.PlaneGeometry(w, h);
    const cell = Math.floor(rand() * 4);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (uv.getX(k) + (cell % 2)) * 0.5, (uv.getY(k) + Math.floor(cell / 2)) * 0.5);
    }
    const pos = new THREE.Vector3(Math.cos(az) * r, y, Math.sin(az) * r);
    const m = new THREE.Matrix4().lookAt(pos, new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 1, 0));
    m.setPosition(pos);
    g.applyMatrix4(m);
    parts.push(g);
  }
  const mesh = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshBasicMaterial({
      map: atlas,
      transparent: true,
      depthWrite: false,
      color: new THREE.Color(1.0, 0.94, 0.88),
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = -2;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

export function createScenery(scene) {
  const timeUniform = { value: 0 };
  const rand = seededRandom(19);
  buildPalms(scene, timeUniform);
  buildBleachers(scene);
  buildUmbrellas(scene, rand);
  buildIslands(scene);
  buildHills(scene, rand);
  const clouds = buildClouds(scene, rand);

  return {
    update(time) {
      timeUniform.value = time;
      clouds.rotation.y = time * 0.0015;
    },
  };
}
