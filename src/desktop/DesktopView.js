import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER } from '../config.js';

const PRESETS = {
  player: { position: [PLAYER.spawn.x + 0.2, 1.75, PLAYER.spawn.z + 1.6], target: [0.4, 1.4, -2] },
  tv: { position: [24, 15, 9], target: [-4, 0.2, 0] },
  net: { position: [-7.5, 2.6, 0.01], target: [0, 1.9, 0] },
  // Câmera de transmissão: acompanha a bola pela lateral, como na TV.
  follow: { position: [8.6, 4.4, 0], target: [0, 1.2, 0] },
  // Vitrine atrás do menu: quadra à direita do card, mar e sol ao fundo.
  hero: { position: [22, 9.5, 11], target: [-2, 0.8, 5.5] },
};

const SWAY_ANGLE = 0.16;
const SWAY_SPEED = 0.09;

/**
 * Câmera do navegador: modo vitrine (órbita lenta atrás do menu) e modo exploração
 * com OrbitControls e presets suaves (jogador, TV, rede).
 */
export class DesktopView {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 60;
    this.controls.enabled = false;
    this.tween = null;
    this.mode = 'menu';
    this.time = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.heroOffset = new THREE.Vector3();
    this.cam = 'hero';
    this.followSource = null;
    this.followTarget = new THREE.Vector3(0, 1.2, 0);
    this.jump('hero');
  }

  jump(name) {
    const p = PRESETS[name];
    this.camera.position.set(...p.position);
    this.controls.target.set(...p.target);
    this.controls.update();
  }

  /** Fonte da câmera "Bola": função que devolve a posição da bola. */
  setFollowSource(fn) {
    this.followSource = fn;
  }

  /** Transição suave para um preset (ease in-out ~0,9 s). */
  goTo(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.cam = name;
    this.controls.enabled = this.mode === 'explore' && name !== 'follow';
    if (this.reducedMotion) {
      this.jump(name);
      return;
    }
    this.tween = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: new THREE.Vector3(...p.position),
      toTarget: new THREE.Vector3(...p.target),
    };
  }

  setMode(mode) {
    const exploring = mode === 'explore';
    this.mode = mode;
    this.controls.enabled = exploring;
    this.goTo(exploring ? 'player' : 'hero');
  }

  #updateFollow(dt) {
    const ball = this.followSource?.();
    if (!ball) return;
    const k = 1 - Math.exp(-dt * 3);
    this.followTarget.set(ball.x * 0.5, THREE.MathUtils.clamp(ball.y * 0.6, 0.8, 3), THREE.MathUtils.clamp(ball.z, -9, 9));
    this.controls.target.lerp(this.followTarget, k);
    const want = new THREE.Vector3(8.6, 4.4, this.controls.target.z * 0.6);
    this.camera.position.lerp(want, k * 0.7);
    this.camera.lookAt(this.controls.target);
  }

  update(dt) {
    this.time += dt;
    if (this.mode === 'menu' && !this.tween && !this.reducedMotion) {
      // Balanço lento em torno da quadra (sem girar a cena inteira).
      const p = PRESETS.hero;
      const angle = Math.sin(this.time * SWAY_SPEED) * SWAY_ANGLE;
      this.heroOffset.set(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
      this.heroOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
      this.controls.target.set(...p.target);
      this.camera.position.copy(this.controls.target).add(this.heroOffset);
      this.camera.lookAt(this.controls.target);
      return;
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) this.tween = null;
      if (this.cam === 'follow') this.camera.lookAt(this.controls.target);
    } else if (this.cam === 'follow' && this.mode === 'explore') {
      this.#updateFollow(dt);
      return;
    }
    this.controls.update(dt);
  }
}
