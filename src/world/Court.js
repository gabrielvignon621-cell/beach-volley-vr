import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT, NET, PLAYER, SUN } from '../config.js';
import {
  createAntennaTexture,
  createBoardTexture,
  createNetBandTexture,
  createNetTexture,
} from './textures.js';

/** Cilindro fino ligando dois pontos (cabos, estais). */
function rod(a, b, radius, radial = 5) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, length, radial, 1, true);
  geo.translate(0, length / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function buildLines() {
  const w = COURT.lineWidth;
  const h = 0.012;
  const y = h / 2 - 0.002;
  const { halfWidth: hw, halfLength: hl } = COURT;
  // As linhas ficam dentro da quadra (padrão FIVB): a borda externa marca o limite.
  const parts = [
    box(w, h, COURT.length, -hw + w / 2, y, 0),
    box(w, h, COURT.length, hw - w / 2, y, 0),
    box(COURT.width, h, w, 0, y, -hl + w / 2),
    box(COURT.width, h, w, 0, y, hl - w / 2),
  ];
  const mesh = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ color: 0x1c4fd6, roughness: 0.55 }),
  );
  mesh.name = 'court-lines';
  return mesh;
}

function buildNet() {
  const group = new THREE.Group();
  group.name = 'net';
  const bottom = NET.topHeight - NET.height;

  const netTexture = createNetTexture();
  netTexture.repeat.set(NET.width / 0.1, NET.height / 0.1);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(NET.width, NET.height),
    new THREE.MeshStandardMaterial({
      color: 0x14213d,
      alphaMap: netTexture,
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.8,
      depthWrite: false,
    }),
  );
  mesh.position.y = bottom + NET.height / 2;
  group.add(mesh);

  const bandTexture = createNetBandTexture();
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(NET.width, 0.07, 0.014),
    new THREE.MeshStandardMaterial({ map: bandTexture, roughness: 0.7 }),
  );
  band.position.y = NET.topHeight - 0.035;
  group.add(band);

  const trim = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.65 });
  const trimGeo = mergeGeometries([
    box(NET.width, 0.03, 0.01, 0, bottom + 0.015, 0),
    // faixas laterais sobre as linhas laterais
    box(0.05, NET.height, 0.016, -COURT.halfWidth + 0.025, bottom + NET.height / 2, 0),
    box(0.05, NET.height, 0.016, COURT.halfWidth - 0.025, bottom + NET.height / 2, 0),
  ]);
  group.add(new THREE.Mesh(trimGeo, trim));

  const antennaTexture = createAntennaTexture();
  const antennaLength = NET.height + NET.antennaAbove;
  antennaTexture.repeat.set(1, antennaLength / 0.2);
  const antennaMaterial = new THREE.MeshStandardMaterial({ map: antennaTexture, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(NET.antennaRadius, NET.antennaRadius, antennaLength, 8),
      antennaMaterial,
    );
    antenna.position.set(side * NET.antennaX, bottom + antennaLength / 2, 0);
    group.add(antenna);
  }
  return group;
}

function buildPosts() {
  const metal = [];
  const pads = [];
  const ropes = [];
  for (const side of [-1, 1]) {
    const x = side * NET.postX;
    metal.push(new THREE.CylinderGeometry(NET.postRadius, NET.postRadius, NET.postHeight, 14).translate(x, NET.postHeight / 2, 0));
    metal.push(new THREE.CylinderGeometry(NET.postRadius * 1.25, NET.postRadius * 1.25, 0.06, 14).translate(x, NET.postHeight, 0));
    pads.push(new THREE.CylinderGeometry(0.12, 0.12, 1.9, 18).translate(x, 0.95, 0));

    // Cabos da rede até o poste e estais até a areia.
    const top = new THREE.Vector3(x, NET.topHeight - 0.02, 0);
    const bot = new THREE.Vector3(x, NET.topHeight - NET.height + 0.02, 0);
    ropes.push(rod(new THREE.Vector3(side * NET.width / 2, top.y, 0), top, 0.006));
    ropes.push(rod(new THREE.Vector3(side * NET.width / 2, bot.y, 0), bot, 0.005));
    const head = new THREE.Vector3(x, NET.postHeight - 0.05, 0);
    ropes.push(rod(head, new THREE.Vector3(x + side * 1.6, 0, -0.9), 0.006));
    ropes.push(rod(head, new THREE.Vector3(x + side * 1.6, 0, 0.9), 0.006));
    for (const z of [-0.9, 0.9]) {
      metal.push(new THREE.CylinderGeometry(0.03, 0.02, 0.12, 6).translate(x + side * 1.6, 0.04, z));
    }
  }

  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeometries(metal), new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 0.7, roughness: 0.32 })));
  group.add(new THREE.Mesh(mergeGeometries(pads), new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.55 })));
  group.add(new THREE.Mesh(mergeGeometries(ropes), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.9 })));
  return group;
}

/**
 * Sombra da rede "assada" na areia: um quadrilátero projetado na direção do sol,
 * usando a mesma textura de malha. Custo quase zero e muito mais realista.
 */
function buildNetShadow() {
  const k = new THREE.Vector2(-SUN.direction.x / SUN.direction.y, -SUN.direction.z / SUN.direction.y);
  const bottom = NET.topHeight - NET.height;
  const project = (x, y) => new THREE.Vector3(x + k.x * y, 0.003, k.y * y);
  const hw = NET.width / 2;
  const corners = [project(-hw, bottom), project(hw, bottom), project(hw, NET.topHeight), project(-hw, NET.topHeight)];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((c) => [c.x, c.y, c.z]), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();

  const texture = createNetTexture();
  texture.repeat.set(NET.width / 0.1, NET.height / 0.1);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x4a2f14,
      alphaMap: texture,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = 1;

  // Faixa superior e postes também projetam sombra.
  const solid = [];
  const strip = (x0, y0, x1, y1, width) => {
    const a = project(x0, y0);
    const b = project(x1, y1);
    const dir = new THREE.Vector3().subVectors(b, a);
    const n = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(width / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      a.x - n.x, 0.0035, a.z - n.z, a.x + n.x, 0.0035, a.z + n.z,
      b.x + n.x, 0.0035, b.z + n.z, b.x - n.x, 0.0035, b.z - n.z,
    ], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    solid.push(g);
  };
  strip(-hw, NET.topHeight - 0.035, hw, NET.topHeight - 0.035, 0.07 / SUN.direction.y * 0.4);
  for (const side of [-1, 1]) strip(side * NET.postX, 0, side * NET.postX, NET.postHeight, 0.1);
  const solidMesh = new THREE.Mesh(
    mergeGeometries(solid),
    new THREE.MeshBasicMaterial({ color: 0x4a2f14, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
  );
  solidMesh.renderOrder = 1;

  const group = new THREE.Group();
  group.add(mesh, solidMesh);
  return group;
}

function buildBoards() {
  const fronts = [];
  const backs = [];
  const legs = [];
  const w = 2.6;
  const h = 0.85;
  const place = (x, z, rotY) => {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0.2 + h / 2, z);
    fronts.push(new THREE.PlaneGeometry(w, h).applyMatrix4(m));
    const back = new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(0, 0, -0.02);
    backs.push(back.applyMatrix4(m));
    for (const lx of [-w / 2 + 0.15, w / 2 - 0.15]) {
      legs.push(new THREE.BoxGeometry(0.05, 0.2 + h, 0.05).translate(lx, (0.2 + h) / 2, -0.04).applyMatrix4(
        new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z),
      ));
    }
  };
  for (const x of [-5.6, -2.8, 0, 2.8, 5.6]) {
    place(x, -COURT.halfLength - 4.2, 0);
    place(x, COURT.halfLength + 4.2, Math.PI);
  }
  for (const z of [-5.6, -2.8, 2.8, 5.6]) place(COURT.halfWidth + 4.2, z, -Math.PI / 2);

  const group = new THREE.Group();
  // Frente e verso com a mesma arte (o verso é um plano próprio, então o texto não espelha).
  group.add(new THREE.Mesh(mergeGeometries([...fronts, ...backs]), new THREE.MeshStandardMaterial({ map: createBoardTexture(), roughness: 0.6 })));
  group.add(new THREE.Mesh(mergeGeometries(legs), new THREE.MeshStandardMaterial({ color: 0x9aa4b1, metalness: 0.6, roughness: 0.4 })));
  return group;
}

/** Marca discreta na areia indicando onde o jogador começa. */
function buildSpawnMarker() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.46, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  ring.position.set(PLAYER.spawn.x, 0.005, PLAYER.spawn.z);
  ring.renderOrder = 1;
  return ring;
}

export function createCourt(scene) {
  const root = new THREE.Group();
  root.name = 'court';
  const net = buildNet();
  root.add(buildLines(), net, buildPosts(), buildNetShadow(), buildBoards(), buildSpawnMarker());
  scene.add(root);

  // A rede balança quando a bola bate nela (mola amortecida).
  let wobble = 0;
  let wobbleVelocity = 0;
  return {
    root,
    hitNet(speed, direction) {
      wobbleVelocity += Math.sign(direction || 1) * Math.min(speed, 25) * 0.06;
    },
    update(dt) {
      if (dt <= 0) return;
      wobbleVelocity += (-wobble * 160 - wobbleVelocity * 9) * dt;
      wobble += wobbleVelocity * dt;
      net.position.z = wobble * 0.5;
      net.children[0].scale.y = 1 - Math.abs(wobble) * 0.08;
    },
  };
}
