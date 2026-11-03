import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const TIPS = FINGERS.map((f) => `${f}-tip`);

// Ossos para o visual: cada dedo é uma cadeia do pulso até a ponta.
const BONES = [];
for (const f of FINGERS) {
  const chain = JOINTS.filter((j) => j.startsWith(f));
  BONES.push(['wrist', chain[0]]);
  for (let i = 0; i < chain.length - 1; i++) BONES.push([chain[i], chain[i + 1]]);
}
// Palma: liga os metacarpos para dar volume.
BONES.push(['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal']);
BONES.push(['middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal']);
BONES.push(['ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']);

const FOREARM_LENGTH = 0.26;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const q1 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Estado rastreado de uma mão (ou de um controle tratado como mão). */
class TrackedSide {
  constructor(index) {
    this.index = index;
    this.handedness = index === 0 ? 'left' : 'right';
    this.mode = null; // 'hand' | 'controller' | null
    this.source = null;
    this.visible = false;
    this.joints = new Map(JOINTS.map((n) => [n, new THREE.Vector3()]));
    this.radii = new Map(JOINTS.map((n) => [n, 0.01]));
    this.palm = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3(0, -1, 0);
    this.wrist = new THREE.Vector3();
    this.elbow = new THREE.Vector3();
    this.forearmDir = new THREE.Vector3(0, 0, 1);
    this.tips = TIPS.map(() => new THREE.Vector3());
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.open = true;
    this.prevPalm = new THREE.Vector3();
    this.hasPrev = false;
    // Colisores (posição atual e no quadro anterior, para varredura contínua).
    this.colliders = [
      { kind: 'palm', radius: 0.055, a: new THREE.Vector3(), prevA: new THREE.Vector3() },
      { kind: 'forearm', radius: 0.045, a: new THREE.Vector3(), b: new THREE.Vector3(), prevA: new THREE.Vector3(), prevB: new THREE.Vector3() },
      ...[1, 2, 3].map(() => ({ kind: 'finger', radius: 0.022, a: new THREE.Vector3(), prevA: new THREE.Vector3() })),
    ];
    this.flash = 0;
  }
}

/**
 * Rig das mãos do jogador:
 * - lê as 25 juntas do XRHand (ou a pose do controle Touch como fallback);
 * - calcula palma, normal, antebraço estimado, velocidade e mão aberta/fechada;
 * - expõe colisores (palma, 3 pontas de dedo, antebraço em cápsula);
 * - detecta postura de manchete (antebraços juntos) e de toque (mãos juntas acima da cabeça);
 * - desenha mãos estilizadas próprias (sem baixar modelos), com brilho no contato.
 */
export class HandRig {
  constructor(renderer, scene, bus) {
    this.renderer = renderer;
    this.bus = bus;
    this.sides = [new TrackedSide(0), new TrackedSide(1)];
    this.head = new THREE.Vector3(0, 1.65, 5);
    this.headForward = new THREE.Vector3(0, 0, -1);
    this.platform = { active: false, center: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) };
    this.setPose = false;
    this.controllers = [];
    this.grips = [];
    this.hands = [];

    const controllerModels = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      controller.addEventListener('connected', (e) => this.#onConnected(i, e.data));
      controller.addEventListener('disconnected', () => this.#onDisconnected(i));
      controller.addEventListener('selectstart', () => this.bus.emit('xr:select', { index: i, side: this.sides[i] }));
      controller.addEventListener('squeezestart', () => this.bus.emit('xr:squeeze', { index: i, side: this.sides[i] }));
      grip.add(controllerModels.createControllerModel(grip));
      scene.add(controller, grip, hand);
      this.controllers.push(controller);
      this.grips.push(grip);
      this.hands.push(hand);
    }

    this.#buildVisuals(scene);
  }

  #onConnected(i, source) {
    // A ordem dos índices não é garantida: guiamos pela lateralidade informada.
    const side = this.sides[i];
    side.source = source;
    side.handedness = source.handedness || side.handedness;
    side.mode = source.hand ? 'hand' : 'controller';
    side.hasPrev = false;
    this.grips[i].visible = side.mode === 'controller';
  }

  #onDisconnected(i) {
    const side = this.sides[i];
    side.source = null;
    side.mode = null;
    side.visible = false;
  }

  /** Lê poses e atualiza estado/colisores. Chamar uma vez por quadro, antes da física. */
  update(dt, camera) {
    camera.getWorldPosition(this.head);
    this.headForward.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(q1));

    for (const side of this.sides) {
      for (const c of side.colliders) {
        c.prevA.copy(c.a);
        if (c.b) c.prevB.copy(c.b);
      }
      if (side.mode === 'hand') this.#readHand(side);
      else if (side.mode === 'controller') this.#readController(side);
      else side.visible = false;

      if (!side.visible) {
        side.hasPrev = false;
        continue;
      }

      // Velocidade suavizada da palma (base da força dos golpes).
      if (side.hasPrev && dt > 0) {
        v1.subVectors(side.palm, side.prevPalm).divideScalar(dt);
        side.velocity.lerp(v1, 0.55);
      } else {
        side.velocity.set(0, 0, 0);
        for (const c of side.colliders) {
          c.prevA.copy(c.a);
          if (c.b) c.prevB.copy(c.b);
        }
      }
      side.speed = side.velocity.length();
      side.prevPalm.copy(side.palm);
      side.hasPrev = true;
      side.flash = Math.max(0, side.flash - dt * 4);
    }

    this.#detectPostures();
    this.#updateVisuals();
  }

  #readHand(side) {
    const hand = this.hands[side.index];
    const joints = hand.joints;
    if (!joints || !joints.wrist || joints.wrist.visible === false) {
      side.visible = false;
      return;
    }
    for (const name of JOINTS) {
      const j = joints[name];
      if (!j) continue;
      j.getWorldPosition(side.joints.get(name));
      side.radii.set(name, j.jointRadius ?? 0.009);
    }
    side.visible = true;
    const J = side.joints;
    side.wrist.copy(J.get('wrist'));
    side.palm.copy(J.get('wrist')).lerp(J.get('middle-finger-phalanx-proximal'), 0.55);

    // Normal da palma pelo produto vetorial pulso→indicador × pulso→mindinho.
    v1.subVectors(J.get('index-finger-phalanx-proximal'), side.wrist);
    v2.subVectors(J.get('pinky-finger-phalanx-proximal'), side.wrist);
    side.palmNormal.crossVectors(v1, v2).normalize();
    if (side.handedness === 'left') side.palmNormal.negate();

    // Antebraço: o Quest não rastreia o cotovelo; estimamos pela orientação do pulso.
    side.forearmDir.set(0, 0, 1).applyQuaternion(joints.wrist.getWorldQuaternion(q1)).normalize();
    side.elbow.copy(side.wrist).addScaledVector(side.forearmDir, FOREARM_LENGTH);

    TIPS.forEach((t, k) => side.tips[k].copy(J.get(t)));
    let spread = 0;
    for (let k = 1; k < 5; k++) spread += side.tips[k].distanceTo(side.palm);
    side.open = spread / 4 > 0.075;

    this.#placeColliders(side, [side.tips[1], side.tips[2], side.tips[3]]);
  }

  #readController(side) {
    const grip = this.grips[side.index];
    if (!grip.visible) {
      side.visible = false;
      return;
    }
    grip.updateWorldMatrix(true, false);
    m4.copy(grip.matrixWorld);
    side.visible = true;
    side.wrist.set(0, 0, 0.06).applyMatrix4(m4);
    side.palm.set(0, -0.01, -0.02).applyMatrix4(m4);
    // Palma voltada para dentro do controle; ao golpear, a velocidade domina a direção.
    side.palmNormal.set(side.handedness === 'left' ? 1 : -1, -0.4, 0).transformDirection(m4).normalize();
    side.forearmDir.set(0, 0.15, 1).transformDirection(m4).normalize();
    side.elbow.copy(side.wrist).addScaledVector(side.forearmDir, FOREARM_LENGTH);
    side.open = true;
    const tip = v3.set(0, 0, -0.08).applyMatrix4(m4);
    this.#placeColliders(side, [tip, tip, tip]);
  }

  #placeColliders(side, fingerPoints) {
    const [palm, forearm, ...fingers] = side.colliders;
    palm.a.copy(side.palm).addScaledVector(side.palmNormal, 0.012);
    forearm.a.copy(side.wrist).addScaledVector(side.forearmDir, 0.05);
    forearm.b.copy(side.elbow);
    fingers.forEach((c, k) => c.a.copy(fingerPoints[k]));
  }

  /** Manchete: antebraços juntos e paralelos. Toque: mãos juntas acima da testa. */
  #detectPostures() {
    const [L, R] = this.sides;
    this.platform.active = false;
    this.setPose = false;
    if (!L.visible || !R.visible) return;

    const midL = v1.addVectors(L.wrist, L.elbow).multiplyScalar(0.5);
    const midR = v2.addVectors(R.wrist, R.elbow).multiplyScalar(0.5);
    const gap = midL.distanceTo(midR);
    const parallel = L.forearmDir.dot(R.forearmDir);
    if (gap < 0.17 && parallel > 0.7 && L.wrist.distanceTo(R.wrist) < 0.16) {
      this.platform.active = true;
      this.platform.center.addVectors(midL, midR).multiplyScalar(0.5);
      // Normal da plataforma: perpendicular aos antebraços, apontando para cima.
      const along = v3.addVectors(L.forearmDir, R.forearmDir).normalize();
      const lateral = new THREE.Vector3().subVectors(R.wrist, L.wrist).normalize();
      this.platform.normal.crossVectors(lateral, along).normalize();
      if (this.platform.normal.y < 0) this.platform.normal.negate();
    }

    const palmsGap = L.palm.distanceTo(R.palm);
    const high = L.palm.y > this.head.y - 0.3 && R.palm.y > this.head.y - 0.3;
    const facing = L.palmNormal.y > -0.3 && R.palmNormal.y > -0.3;
    this.setPose = high && facing && palmsGap > 0.06 && palmsGap < 0.42;
  }

  /** Brilho rápido e vibração no contato. */
  feedback(sideIndex, intensity) {
    const side = this.sides[sideIndex];
    if (!side) return;
    side.flash = 1;
    const actuator = side.source?.gamepad?.hapticActuators?.[0];
    actuator?.pulse?.(Math.min(1, 0.25 + intensity * 0.75), 25 + intensity * 45);
  }

  /** Lado (0/1) cuja palma está mais perto de um ponto. */
  nearestSide(point) {
    let best = -1;
    let bestD = Infinity;
    for (const s of this.sides) {
      if (!s.visible) continue;
      const d = s.palm.distanceTo(point);
      if (d < bestD) { bestD = d; best = s.index; }
    }
    return best;
  }

  /* ---------- Visual próprio das mãos ---------- */

  #buildVisuals(scene) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac86, roughness: 0.62, metalness: 0 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.7 });
    this.visuals = this.sides.map(() => {
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), skin.clone(), JOINTS.length);
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), joints.material, BONES.length);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), joints.material);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 1, 12), joints.material);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), sleeve);
      for (const o of [joints, bones, palm, arm, band]) {
        o.frustumCulled = false;
        o.visible = false;
        scene.add(o);
      }
      return { joints, bones, palm, arm, band };
    });
  }

  #updateVisuals() {
    this.sides.forEach((side, i) => {
      const vis = this.visuals[i];
      const show = side.visible;
      const handMode = side.mode === 'hand';
      vis.joints.visible = show && handMode;
      vis.bones.visible = show && handMode;
      vis.palm.visible = show && handMode;
      vis.arm.visible = show;
      vis.band.visible = show;
      if (!show) return;

      const glow = side.flash;
      vis.joints.material.emissive.setRGB(1, 0.6, 0.3).multiplyScalar(glow * 0.6);

      if (handMode) {
        JOINTS.forEach((name, k) => {
          const r = Math.max(side.radii.get(name), 0.006) * 1.05;
          m4.makeScale(r, r, r).setPosition(side.joints.get(name));
          vis.joints.setMatrixAt(k, m4);
        });
        vis.joints.instanceMatrix.needsUpdate = true;
        BONES.forEach(([a, b], k) => {
          const pa = side.joints.get(a);
          const pb = side.joints.get(b);
          const len = pa.distanceTo(pb);
          const r = Math.min(side.radii.get(a), side.radii.get(b)) * 0.95;
          q1.setFromUnitVectors(UP, v1.subVectors(pb, pa).normalize());
          m4.compose(v2.addVectors(pa, pb).multiplyScalar(0.5), q1, v3.set(r, len, r));
          vis.bones.setMatrixAt(k, m4);
        });
        vis.bones.instanceMatrix.needsUpdate = true;

        // Volume da palma: elipsoide alinhado à mão.
        const J = side.joints;
        const across = v1.subVectors(J.get('index-finger-phalanx-proximal'), J.get('pinky-finger-phalanx-proximal'));
        const width = across.length() * 0.62;
        const along = v2.subVectors(J.get('middle-finger-phalanx-proximal'), side.wrist);
        const length = along.length() * 0.55;
        const basis = new THREE.Matrix4().makeBasis(across.normalize(), side.palmNormal, along.normalize());
        vis.palm.quaternion.setFromRotationMatrix(basis);
        vis.palm.position.copy(side.palm);
        vis.palm.scale.set(width, 0.018, length);
      }

      // Antebraço estimado (mostra onde a manchete encosta) + munhequeira.
      const dir = side.forearmDir;
      const len = FOREARM_LENGTH - 0.04;
      vis.arm.position.copy(side.wrist).addScaledVector(dir, 0.04 + len / 2);
      vis.arm.quaternion.setFromUnitVectors(UP, dir);
      vis.arm.scale.set(0.033, len, 0.033);
      vis.band.position.copy(side.wrist).addScaledVector(dir, 0.045);
      vis.band.quaternion.copy(vis.arm.quaternion);
      vis.band.scale.set(0.038, 0.05, 0.038);
    });
  }
}
