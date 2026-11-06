import * as THREE from 'three';
import { COURT, PLAYER } from '../config.js';

const SNAP_ANGLE = Math.PI / 4;
const ARC_SPEED = 7.5;
const ARC_POINTS = 40;
const FADE_TIME = 0.12;
const POINT_HOLD = 0.25; // segundos apontando antes do arco aparecer
const CALIB_DELAY = 0.5; // espera o headset estabilizar a pose antes de calibrar
const MAX_LIFT = 0.9; // limite da correção de altura (m)

const head = new THREE.Vector3();
const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();

/**
 * Locomoção confortável:
 * - room-scale é o padrão (você anda de verdade);
 * - controles: snap-turn de 45° no analógico direito (para os lados) e teletransporte
 *   com arco parabólico (empurre para frente, mire, solte) só dentro do seu lado da quadra;
 * - recentralizar coloca você na posição de recepção, de frente para a rede.
 * O "rig" é uma transformação aplicada ao reference space do WebXR, com fade curto.
 */
export class Locomotion {
  constructor(renderer, scene, rig) {
    this.renderer = renderer;
    this.rig = rig;
    this.matrix = new THREE.Matrix4().makeTranslation(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    this.base = null;
    this.snapReady = true;
    this.aiming = false;
    this.target = new THREE.Vector3();
    this.valid = false;
    this.fade = { t: 0, phase: null, action: null };
    this.calib = -1;
    this.lift = 0;
    this.point = [0, 0]; // tempo segurando o gesto de apontar, por mão
    this.aimSide = -1;
    this.onTeleport = null;
    this.handsEnabled = true; // desligado com o menu aberto (apontar+pinça é o clique do menu)
    this.ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    this.arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.9 }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.marker.visible = false;
    this.fader = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.fader.renderOrder = 1000;
    this.fader.visible = false;
    scene.add(this.arc, this.marker, this.fader);
  }

  /** Chamado ao iniciar a sessão: guarda o espaço base e aplica a posição inicial. */
  begin() {
    this.base = this.renderer.xr.getReferenceSpace();
    this.matrix.makeTranslation(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    this.lift = 0;
    this.#apply();
    // Calibra posição e altura assim que a pose da cabeça for válida.
    this.calib = CALIB_DELAY;
  }

  end() {
    this.base = null;
  }

  #apply() {
    if (!this.base) return;
    m1.copy(this.matrix).invert();
    m1.decompose(pos, quat, scl);
    const transform = new XRRigidTransform({ x: pos.x, y: pos.y, z: pos.z }, { x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this.renderer.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(transform));
  }

  #withFade(action) {
    this.fade = { t: 0, phase: 'out', action };
    this.fader.visible = true;
  }

  #headWorld() {
    return this.renderer.xr.getCamera().getWorldPosition(head);
  }

  snapTurn(direction) {
    this.#withFade(() => {
      const h = this.#headWorld().clone();
      m1.makeTranslation(h.x, 0, h.z).multiply(m2.makeRotationY(-direction * SNAP_ANGLE)).multiply(new THREE.Matrix4().makeTranslation(-h.x, 0, -h.z));
      this.matrix.premultiply(m1);
      this.#apply();
    });
  }

  teleport(point) {
    this.onTeleport?.();
    this.#withFade(() => {
      const h = this.#headWorld();
      this.matrix.premultiply(m1.makeTranslation(point.x - h.x, 0, point.z - h.z));
      this.#apply();
    });
  }

  /** Volta para a posição de recepção, olhando para a rede, com os olhos na altura dos atletas. */
  recenter() {
    this.#withFade(() => this.#recenterNow());
  }

  #recenterNow() {
    const camera = this.renderer.xr.getCamera();
    const h = camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    m1.makeTranslation(h.x, 0, h.z).multiply(m2.makeRotationY(-yaw)).multiply(new THREE.Matrix4().makeTranslation(-h.x, 0, -h.z));
    this.matrix.premultiply(m1);
    // Altura: leva os olhos para PLAYER.eyeHeight (mesma altura dos bots), seja qual for a altura real.
    const realEye = h.y - this.lift;
    const lift = THREE.MathUtils.clamp(PLAYER.eyeHeight - realEye, -MAX_LIFT, MAX_LIFT);
    this.matrix.premultiply(new THREE.Matrix4().makeTranslation(PLAYER.spawn.x - h.x, lift - this.lift, PLAYER.spawn.z - h.z));
    this.lift = lift;
    this.#apply();
  }

  update(dt) {
    this.#updateFade(dt);
    if (!this.base) return;
    if (this.calib > 0) {
      this.calib -= dt;
      const y = this.#headWorld().y;
      if (this.calib <= 0) {
        if (y > 0.3) this.#recenterNow();
        else this.calib = 0.1;
      }
    }
    if (this.#updateHandGesture(dt)) return;
    const right = this.rig.sides.find((s) => s.mode === 'controller' && s.handedness === 'right');
    const axes = right?.source?.gamepad?.axes;
    if (!axes || axes.length < 4) {
      this.arc.visible = false;
      this.marker.visible = false;
      return;
    }
    const x = axes[2];
    const y = axes[3];

    if (Math.abs(x) > 0.75 && this.snapReady && !this.aiming) {
      this.snapReady = false;
      this.snapTurn(Math.sign(x));
    }
    if (Math.abs(x) < 0.3) this.snapReady = true;

    if (y < -0.7) {
      this.aiming = true;
      this.#aim(this.rig.controllers[right.index]);
    } else if (this.aiming && y > -0.3) {
      this.aiming = false;
      this.arc.visible = false;
      this.marker.visible = false;
      if (this.valid) this.teleport(this.target);
    }
  }

  /**
   * Teleporte com as mãos: aponte com o indicador (outros dedos dobrados) para o chão do seu lado,
   * segure ~0,25 s até o arco aparecer, e abra a mão (ou feche o punho) para ir até lá.
   * Retorna true enquanto o gesto está controlando o arco.
   */
  #updateHandGesture(dt) {
    let active = -1;
    for (const side of this.rig.sides) {
      const i = side.index;
      if (!this.handsEnabled || side.mode !== 'hand' || !side.visible || !this.#isPointing(side)) {
        this.point[i] = 0;
        continue;
      }
      this.point[i] += dt;
      if (this.point[i] >= POINT_HOLD && (active < 0 || i === this.aimSide)) active = i;
    }
    if (active >= 0) {
      const J = this.rig.sides[active].joints;
      this.ray.origin.copy(J.get('index-finger-tip'));
      this.ray.dir.subVectors(J.get('index-finger-tip'), J.get('index-finger-phalanx-proximal')).normalize();
      if (this.aimSide !== active) this.rig.feedback?.(active, 0.2);
      this.aimSide = active;
      this.#aimRay(this.ray.origin, this.ray.dir);
      return true;
    }
    if (this.aimSide >= 0) {
      this.aimSide = -1;
      this.arc.visible = false;
      this.marker.visible = false;
      if (this.valid) this.teleport(this.target);
      return true;
    }
    return false;
  }

  /** Indicador esticado, médio/anelar/mindinho dobrados. */
  #isPointing(side) {
    const J = side.joints;
    const wrist = J.get('wrist');
    const ext = (f) => J.get(`${f}-tip`).distanceTo(wrist) / Math.max(0.03, J.get(`${f}-phalanx-proximal`).distanceTo(wrist));
    return ext('index-finger') > 1.75 && ext('middle-finger') < 1.4 && ext('ring-finger') < 1.4 && ext('pinky-finger') < 1.45;
  }

  #aim(controller) {
    controller.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(controller.matrixWorld);
    this.#aimRay(origin, dir);
  }

  #aimRay(origin, direction) {
    const v = direction.clone().multiplyScalar(ARC_SPEED);
    const positions = this.arc.geometry.attributes.position;
    const p = origin.clone();
    let landed = false;
    const dt = 0.035;
    for (let i = 0; i < ARC_POINTS; i++) {
      if (!landed) {
        p.addScaledVector(v, dt);
        v.y -= 9.8 * dt;
        if (p.y <= 0 && v.y < 0) {
          p.y = 0.01;
          landed = true;
          this.target.copy(p);
        }
      }
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    positions.needsUpdate = true;
    this.valid = landed && this.target.z > 0.4 && this.target.z < COURT.halfLength + 3 && Math.abs(this.target.x) < COURT.halfWidth + 3;
    const color = this.valid ? 0x2dd4bf : 0xf87171;
    this.arc.material.color.set(color);
    this.marker.material.color.set(color);
    this.arc.visible = true;
    this.marker.visible = landed;
    this.marker.position.copy(this.target);
  }

  #updateFade(dt) {
    const f = this.fade;
    if (!f.phase) return;
    f.t += dt;
    const camera = this.renderer.xr.getCamera();
    this.fader.position.copy(camera.getWorldPosition(head));
    if (f.phase === 'out') {
      this.fader.material.opacity = Math.min(1, f.t / FADE_TIME);
      if (f.t >= FADE_TIME) {
        f.action?.();
        f.phase = 'in';
        f.t = 0;
      }
    } else {
      this.fader.material.opacity = Math.max(0, 1 - f.t / FADE_TIME);
      if (f.t >= FADE_TIME) {
        f.phase = null;
        this.fader.visible = false;
      }
    }
  }
}
