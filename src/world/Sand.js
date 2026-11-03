import * as THREE from 'three';
import { COURT, WORLD } from '../config.js';
import { createSandTextures, fbm } from './textures.js';

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Altura da areia. A área de jogo é plana (casa com o chão físico em y = 0);
 * longe dela surgem dunas, e para o lado do mar a praia desce até a água.
 */
export function sandHeight(x, z) {
  let h = 0;
  if (x < WORLD.beachSlopeStartX) h -= (WORLD.beachSlopeStartX - x) * WORLD.beachSlope;

  const dx = Math.max(Math.abs(x) - (COURT.halfWidth + 5), 0);
  const dz = Math.max(Math.abs(z) - (COURT.halfLength + 5), 0);
  const away = smooth(Math.min(Math.hypot(dx, dz) / 14, 1));
  const landward = x > WORLD.beachSlopeStartX ? 1 : 0.15;
  h += (fbm(x * 0.035 + 50, z * 0.035 + 50, { octaves: 4 }) - 0.35) * 2.4 * away * landward;

  // Ondulação suave fora da quadra, para a areia não parecer um piso.
  const insideCourt = Math.abs(x) < COURT.halfWidth + 1.5 && Math.abs(z) < COURT.halfLength + 1.5;
  if (!insideCourt) h += (fbm(x * 0.4, z * 0.4, { octaves: 2, seed: 7 }) - 0.5) * 0.06;
  return h;
}

export function createSand(scene) {
  const size = 320;
  const segments = 200;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(0xffffff);
  const wet = new THREE.Color(0x9a8468);
  const tint = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = sandHeight(x, z);
    pos.setY(i, y);
    uv.setXY(i, (x / size + 0.5) * 80, (z / size + 0.5) * 80);

    // Areia molhada escurece perto da linha d'água; variação macro quebra a repetição.
    const wetness = 1 - smooth(THREE.MathUtils.clamp((x - WORLD.shorelineX) / 4.5, 0, 1));
    const macro = 0.92 + fbm(x * 0.05, z * 0.05, { octaves: 3, seed: 11 }) * 0.14;
    tint.copy(dry).lerp(wet, wetness * 0.85).multiplyScalar(macro);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const { map, normalMap } = createSandTextures(512);
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.96,
    metalness: 0,
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sand';
  scene.add(mesh);
  return mesh;
}
