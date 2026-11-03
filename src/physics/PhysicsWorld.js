import RAPIER from '@dimforge/rapier3d-compat';
import { NET, PHYSICS } from '../config.js';

export { RAPIER };

let ready = null;

/** Carrega o módulo WASM do Rapier uma única vez. */
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

/**
 * Mundo físico com passo fixo (120 Hz) e acumulador, independente da taxa de quadros.
 * O render interpola entre os dois últimos passos usando `alpha`.
 */
export class PhysicsWorld {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.step;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.surfaces = new Map();
    this.preStep = [];
    this.postStep = [];
    this.contactListeners = [];
    this.accumulator = 0;
    this.alpha = 0;
    this.#buildStaticColliders();
  }

  /** Registra um colisor estático com uma etiqueta de superfície ('sand', 'net', ...). */
  addStatic(desc, surface) {
    const collider = this.world.createCollider(desc);
    this.surfaces.set(collider.handle, surface);
    return collider;
  }

  surfaceOf(handle) {
    return this.surfaces.get(handle);
  }

  /**
   * Avança a simulação. Os callbacks de preStep recebem (dt, t0, t1): a fração do
   * quadro coberta por este subpasso, para interpolar objetos que só atualizam
   * por quadro (mãos, controles) e não deixar a bola atravessá-los.
   */
  step(deltaSeconds) {
    this.accumulator += Math.min(deltaSeconds, PHYSICS.step * PHYSICS.maxSubSteps);
    const count = Math.floor(this.accumulator / PHYSICS.step);
    let index = 0;
    while (this.accumulator >= PHYSICS.step) {
      const t0 = count > 0 ? index / count : 0;
      const t1 = count > 0 ? (index + 1) / count : 1;
      index++;
      for (const fn of this.preStep) fn(PHYSICS.step, t0, t1);
      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        for (const fn of this.contactListeners) fn(h1, h2);
      });
      for (const fn of this.postStep) fn(PHYSICS.step);
      this.accumulator -= PHYSICS.step;
    }
    this.alpha = this.accumulator / PHYSICS.step;
  }

  #buildStaticColliders() {
    const { Min } = RAPIER.CoefficientCombineRule;

    // Areia: quica pouco e segura a bola.
    this.addStatic(
      RAPIER.ColliderDesc.cuboid(160, 1, 160)
        .setTranslation(0, -1, 0)
        .setRestitution(0.3)
        .setRestitutionCombineRule(Min)
        .setFriction(0.95),
      'sand',
    );

    // Rede: absorve a bola e a deixa cair.
    const netCenterY = NET.topHeight - NET.height / 2;
    this.addStatic(
      RAPIER.ColliderDesc.cuboid(NET.width / 2, NET.height / 2, 0.012)
        .setTranslation(0, netCenterY, 0)
        .setRestitution(0.06)
        .setRestitutionCombineRule(Min)
        .setFriction(0.9),
      'net',
    );

    for (const side of [-1, 1]) {
      this.addStatic(
        RAPIER.ColliderDesc.cylinder(NET.postHeight / 2, NET.postRadius + 0.05)
          .setTranslation(side * NET.postX, NET.postHeight / 2, 0)
          .setRestitution(0.45),
        'post',
      );

      const antennaLength = NET.height + NET.antennaAbove;
      this.addStatic(
        RAPIER.ColliderDesc.cylinder(antennaLength / 2, NET.antennaRadius)
          .setTranslation(side * NET.antennaX, NET.topHeight - NET.height + antennaLength / 2, 0)
          .setRestitution(0.2),
        'antenna',
      );
    }
  }
}
