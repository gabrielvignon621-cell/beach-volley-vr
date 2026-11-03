import * as THREE from 'three';
import { COURT, PLAYER } from '../config.js';

const SNAP_ANGLE = Math.PI / 4;
const ARC_SPEED = 7.5;
const ARC_POINTS = 40;
const FADE_TIME = 0.12;

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
    this.#apply();
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
    this.#withFade(() => {
      const h = this.#headWorld();
      this.matrix.premultiply(m1.makeTranslation(point.x - h.x, 0, point.z - h.z));
      this.#apply();
    });
  }

  /** Volta para a posição de recepção, olhando para a rede. */
  recenter() {
    this.#withFade(() => {
      const camera = this.renderer.xr.getCamera();
      const h = camera.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      m1.makeTranslation(h.x, 0, h.z).multiply(m2.makeRotationY(-yaw)).multiply(new THREE.Matrix4().makeTranslation(-h.x, 0, -h.z));
      this.matrix.premultiply(m1);
      this.matrix.premultiply(new THREE.Matrix4().makeTranslation(PLAYER.spawn.x - h.x, 0, PLAYER.spawn.z - h.z));
      this.#apply();
    });
  }

  update(dt) {
    this.#updateFade(dt);
    if (!this.base) return;
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

  #aim(controller) {
    controller.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(controller.matrixWorld);
    const v = dir.multiplyScalar(ARC_SPEED);
    const positions = this.arc.geometry.attributes.position;
    const p = origin.clone();
    let landed = false;
    const dt = 0.035;
    for (let i = 0; i < ARC_POINTS; i++) {
      if (!landed) {
        p.addScaledVector(v, dt);
        v.y -= 9.8 * dt;
        if (p.y <= 0) {
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
