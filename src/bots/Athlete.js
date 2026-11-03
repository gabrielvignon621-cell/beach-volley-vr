import * as THREE from 'three';
import { createBlobShadowTexture } from '../world/textures.js';

const THIGH = 0.45;
const SHIN = 0.45;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
const HIP_HEIGHT = THIGH + SHIN + 0.05;

/*
 * Ângulos dos braços por pose: [ombro pitch (negativo = para frente/cima), ombro roll (abre), cotovelo].
 * Braço em repouso aponta para baixo (-Y).
 */
const ARM_POSES = {
  idle: { l: [-0.15, 0.12, -0.25], r: [-0.15, 0.12, -0.25] },
  ready: { l: [-0.75, 0.22, -1.0], r: [-0.75, 0.22, -1.0] },
  bump: { l: [-1.05, -0.32, -0.05], r: [-1.05, -0.32, -0.05] },
  set: { l: [-2.75, 0.42, -1.15], r: [-2.75, 0.42, -1.15] },
  spikeLoad: { l: [-2.6, 0.2, -0.3], r: [-2.9, 0.35, -2.1] },
  spikeSwing: { l: [-0.6, 0.15, -0.3], r: [-0.35, 0.05, -0.05] },
  block: { l: [-3.05, 0.08, -0.05], r: [-3.05, 0.08, -0.05] },
  dive: { l: [-1.6, -0.2, 0], r: [-1.6, -0.2, 0] },
  toss: { l: [-2.8, 0.1, -0.2], r: [-2.6, 0.45, -1.9] },
  celebrate: { l: [-2.85, 0.65, -0.3], r: [-2.85, 0.65, -0.3] },
  sad: { l: [-0.05, 0.05, -0.1], r: [-0.05, 0.05, -0.1] },
};

function limb(length, radiusTop, radiusBottom, material) {
  const geo = new THREE.CapsuleGeometry((radiusTop + radiusBottom) / 2, length - (radiusTop + radiusBottom), 4, 10);
  geo.translate(0, -length / 2, 0);
  return new THREE.Mesh(geo, material);
}

/**
 * Atleta low-poly com esqueleto procedural. Não usa animações gravadas:
 * cada quadro mistura uma pose de braços, agachamento, ciclo de corrida,
 * salto, mergulho e inclinação a partir do estado do bot.
 */
export class Athlete {
  constructor(scene, { jersey = 0x14a3b8, shorts = 0x1b2333, skin = 0xc68a5e, hair = 0x2a1a10, number = 7, name = '' } = {}) {
    this.root = new THREE.Group();
    this.root.name = `athlete-${name}`;

    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
    const jerseyMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.75 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.8 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9 });
    this.jerseyMat = jerseyMat;

    // Quadril (pivô do corpo)
    this.hips = new THREE.Group();
    this.hips.position.y = HIP_HEIGHT;
    this.root.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.12, 4, 10).rotateZ(Math.PI / 2), shortsMat);
    pelvis.scale.set(1, 1, 0.85);
    this.hips.add(pelvis);

    // Tronco
    this.spine = new THREE.Group();
    this.spine.position.y = 0.05;
    this.hips.add(this.spine);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 12), jerseyMat);
    torso.position.y = 0.3;
    torso.scale.set(1.15, 1, 0.72);
    this.spine.add(torso);
    this.#addNumber(torso, number, jersey);

    // Cabeça
    this.neck = new THREE.Group();
    this.neck.position.y = 0.6;
    this.spine.add(this.neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skinMat);
    head.position.y = 0.14;
    head.scale.set(0.92, 1.05, 1);
    this.neck.add(head);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hairCap.position.y = 0.155;
    hairCap.rotation.x = -0.25;
    this.neck.add(hairCap);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16, 1, false, -0.9, 1.8).translate(0, 0, 0.04), jerseyMat);
    visor.position.set(0, 0.2, 0.05);
    visor.rotation.x = 0.18;
    this.neck.add(visor);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skinMat);
    neckMesh.position.y = 0.03;
    this.neck.add(neckMesh);

    // Braços
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, 0.5, 0);
      this.spine.add(shoulder);
      const upper = limb(UPPER_ARM, 0.055, 0.045, skinMat);
      shoulder.add(upper);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.12, 10), jerseyMat);
      sleeve.position.y = -0.04;
      shoulder.add(sleeve);
      const elbow = new THREE.Group();
      elbow.position.y = -UPPER_ARM;
      shoulder.add(elbow);
      elbow.add(limb(FOREARM, 0.045, 0.038, skinMat));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skinMat);
      hand.position.y = -FOREARM - 0.03;
      hand.scale.set(0.8, 1.2, 0.5);
      elbow.add(hand);
      return { shoulder, elbow, hand, side };
    });

    // Pernas
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, -0.04, 0);
      this.hips.add(hip);
      const shortLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.2, 10).translate(0, -0.1, 0), shortsMat);
      hip.add(shortLeg);
      hip.add(limb(THIGH, 0.075, 0.06, skinMat));
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      knee.add(limb(SHIN, 0.058, 0.045, skinMat));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.22).translate(0, 0, 0.05), skinMat);
      foot.position.y = -SHIN - 0.02;
      knee.add(foot);
      return { hip, knee, foot, side };
    });

    // Sombra de contato
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: createBlobShadowTexture(), transparent: true, depthWrite: false, color: 0x3a2410, opacity: 0.5 }),
    );
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    scene.add(this.root);

    // Estado de pose (alvos) e valores atuais suavizados
    this.pose = {
      arms: 'ready',
      crouch: 0.35,
      lean: 0.1,
      runPhase: 0,
      runAmount: 0,
      strafe: 0,
      jump: 0,
      dive: 0,
      celebrate: 0,
    };
    this.current = {
      l: [...ARM_POSES.ready.l],
      r: [...ARM_POSES.ready.r],
      crouch: 0.35,
      lean: 0.1,
      dive: 0,
    };
  }

  #addNumber(torso, number, jersey) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `#${new THREE.Color(jersey).getHexString()}`;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const z of [-1, 1]) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
      patch.position.set(0, 0.04, z * 0.128);
      if (z < 0) patch.rotation.y = Math.PI;
      torso.add(patch);
    }
  }

  /** Posição das mãos no mundo (para bloqueio e contato). */
  handWorld(index, out = new THREE.Vector3()) {
    return this.arms[index].hand.getWorldPosition(out);
  }

  update(dt) {
    const p = this.pose;
    const c = this.current;
    const k = 1 - Math.exp(-dt * 14);
    const target = ARM_POSES[p.arms] ?? ARM_POSES.ready;
    for (let i = 0; i < 3; i++) {
      c.l[i] += (target.l[i] - c.l[i]) * k;
      c.r[i] += (target.r[i] - c.r[i]) * k;
    }
    const kb = 1 - Math.exp(-dt * 9);
    c.crouch += (p.crouch - c.crouch) * kb;
    c.lean += (p.lean - c.lean) * kb;
    c.dive += (p.dive - c.dive) * (1 - Math.exp(-dt * 7));

    // Pernas: agachamento mantém o pé sob o quadril (joelho = 2x quadril).
    const bend = c.crouch * 1.25;
    const run = p.runAmount;
    this.legs.forEach((leg, i) => {
      const phase = p.runPhase + (i === 0 ? 0 : Math.PI);
      const swing = Math.sin(phase) * 0.75 * run;
      const lift = Math.max(0, -Math.cos(phase)) * 0.9 * run;
      leg.hip.rotation.x = -bend / 2 - swing - c.dive * 0.4;
      leg.knee.rotation.x = bend + lift + c.dive * 0.2;
      leg.hip.rotation.z = -leg.side * (0.06 + Math.abs(p.strafe) * 0.15);
      leg.foot.rotation.x = -bend / 2;
    });
    const legReach = THIGH * Math.cos(bend / 2) + SHIN * Math.cos(bend / 2);
    const bob = Math.abs(Math.sin(p.runPhase)) * 0.04 * run;
    this.hips.position.y = legReach + 0.05 + bob + p.jump - c.dive * 0.62;
    this.hips.position.z = c.dive * 0.25;

    // Tronco inclina para frente ao agachar, correr e mergulhar.
    this.spine.rotation.x = c.lean + c.crouch * 0.35 + run * 0.15 + c.dive * 1.15;
    this.spine.rotation.z = -p.strafe * 0.12;
    this.neck.rotation.x = -this.spine.rotation.x * 0.65;

    // Braços com balanço de corrida quando a pose é "ready".
    const armSwing = p.arms === 'ready' || p.arms === 'idle' ? Math.sin(p.runPhase) * 0.6 * run : 0;
    const [L, R] = this.arms;
    L.shoulder.rotation.set(c.l[0] + armSwing, 0, -c.l[1]);
    L.elbow.rotation.x = c.l[2];
    R.shoulder.rotation.set(c.r[0] - armSwing, 0, c.r[1]);
    R.elbow.rotation.x = c.r[2];

    // Sombra
    this.shadow.position.set(this.root.position.x, 0.005, this.root.position.z);
    const s = 1 + p.jump * 0.4 + c.dive * 0.6;
    this.shadow.scale.set(s, 1, s + c.dive);
    this.shadow.rotation.y = this.root.rotation.y;
    this.shadow.material.opacity = 0.5 - p.jump * 0.3;
  }

  /** Estado compacto para o replay. */
  capture(out) {
    const r = this.root;
    const c = this.current;
    out.push(r.position.x, r.position.y, r.position.z, r.rotation.y,
      c.l[0], c.l[1], c.l[2], c.r[0], c.r[1], c.r[2], c.crouch, c.lean, c.dive,
      this.pose.runPhase, this.pose.runAmount, this.pose.jump, this.pose.strafe);
  }

  static CAPTURE_SIZE = 17;

  restore(data, o) {
    this.root.position.set(data[o], data[o + 1], data[o + 2]);
    this.root.rotation.y = data[o + 3];
    const c = this.current;
    c.l[0] = data[o + 4]; c.l[1] = data[o + 5]; c.l[2] = data[o + 6];
    c.r[0] = data[o + 7]; c.r[1] = data[o + 8]; c.r[2] = data[o + 9];
    c.crouch = data[o + 10]; c.lean = data[o + 11]; c.dive = data[o + 12];
    this.pose.runPhase = data[o + 13];
    this.pose.runAmount = data[o + 14];
    this.pose.jump = data[o + 15];
    this.pose.strafe = data[o + 16];
    this.pose.crouch = c.crouch;
    this.pose.lean = c.lean;
    this.pose.dive = c.dive;
  }

  /** Atualiza só a malha a partir do estado restaurado (sem suavização). */
  applyRestored() {
    const saved = this.pose.arms;
    this.pose.arms = '__none__';
    const c = this.current;
    const l = [...c.l];
    const r = [...c.r];
    ARM_POSES.__none__ = { l, r };
    this.update(0);
    this.pose.arms = saved;
    delete ARM_POSES.__none__;
  }
}
