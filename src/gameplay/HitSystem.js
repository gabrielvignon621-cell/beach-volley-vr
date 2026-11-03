import * as THREE from 'three';
import { BALL } from '../config.js';

const SAMPLES = 4;
const COOLDOWN = 0.22;

const ballA = new THREE.Vector3();
const ballP = new THREE.Vector3();
const colA = new THREE.Vector3();
const colB = new THREE.Vector3();
const closest = new THREE.Vector3();
const normal = new THREE.Vector3();
const seg = new THREE.Vector3();

function closestOnSegment(p, a, b, out) {
  seg.subVectors(b, a);
  const lenSq = seg.lengthSq();
  const t = lenSq > 0 ? THREE.MathUtils.clamp(seg.dot(out.subVectors(p, a)) / lenSq, 0, 1) : 0;
  return out.copy(a).addScaledVector(seg, t);
}

/**
 * Detecta contatos entre a bola e os "atacantes" (mãos do jogador, bloqueio dos bots)
 * com varredura contínua: em cada subpasso de 120 Hz testa 4 posições intermediárias
 * da bola e dos colisores. Assim nem uma cortada a 30 m/s atravessa a mão.
 *
 * Um striker é: { actor, colliders: [{kind, radius, a, prevA, b?, prevB?}], frameDt, resolve(contact) }.
 * `resolve` devolve { kind, velocity, spin } ou null (sem golpe).
 */
export class HitSystem {
  constructor(physics, ball, bus) {
    this.ball = ball;
    this.bus = bus;
    this.strikers = [];
    this.cooldowns = new Map();
    this.gate = () => true;
    physics.preStep.push((dt, t0, t1) => this.#check(dt, t0, t1));
  }

  add(striker) {
    this.strikers.push(striker);
    return striker;
  }

  /** Aplica um golpe na bola (usado também pelos bots) e avisa o resto do jogo. */
  apply(actor, kind, velocity, spin, position = null, extra = {}) {
    this.ball.strike(velocity, spin, position);
    this.cooldowns.set(actor, COOLDOWN);
    this.bus.emit('ball:hit', {
      actor,
      kind,
      position: new THREE.Vector3().copy(position ?? this.ball.position),
      speed: Math.hypot(velocity.x, velocity.y, velocity.z),
      ...extra,
    });
  }

  #check(dt, t0, t1) {
    for (const [actor, t] of this.cooldowns) {
      const left = t - dt;
      if (left <= 0) this.cooldowns.delete(actor);
      else this.cooldowns.set(actor, left);
    }
    if (this.ball.parked && !this.ball.holdHittable) return;

    const ball = this.ball;
    const v = ball.body.linvel();
    ballA.copy(ball.current);

    for (const striker of this.strikers) {
      if (striker.enabled && !striker.enabled()) continue;
      if (this.cooldowns.has(striker.actor)) continue;
      if (!this.gate(striker.actor)) continue;

      for (const c of striker.colliders()) {
        const reach = c.radius + BALL.radius;
        for (let s = 1; s <= SAMPLES; s++) {
          const k = s / SAMPLES;
          const f = t0 + (t1 - t0) * k;
          ballP.set(ballA.x + v.x * dt * k, ballA.y + v.y * dt * k, ballA.z + v.z * dt * k);
          colA.lerpVectors(c.prevA, c.a, f);
          if (c.b) {
            colB.lerpVectors(c.prevB, c.b, f);
            closestOnSegment(ballP, colA, colB, closest);
          } else {
            closest.copy(colA);
          }
          const dist = closest.distanceTo(ballP);
          if (dist >= reach) continue;

          normal.subVectors(ballP, closest);
          if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
          normal.normalize();

          // Velocidade do colisor neste instante (diferença entre quadros).
          const frameDt = striker.frameDt || 1 / 72;
          const colVel = new THREE.Vector3().subVectors(c.a, c.prevA).divideScalar(frameDt);
          const ballVel = new THREE.Vector3(v.x, v.y, v.z);
          const approach = new THREE.Vector3().subVectors(ballVel, colVel).dot(normal);
          if (approach > 0.6) continue; // já se afastando: não "gruda"

          const contact = {
            collider: c,
            point: closest.clone(),
            ballPosition: ballP.clone(),
            normal: normal.clone(),
            ballVelocity: ballVel,
            colliderVelocity: colVel,
          };
          const result = striker.resolve(contact);
          if (!result) break;
          // Tira a bola de dentro do colisor para o próximo passo começar limpo.
          const out = closest.clone().addScaledVector(normal, reach + 0.004);
          this.apply(striker.actor, result.kind, result.velocity, result.spin ?? { x: 0, y: 0, z: 0 }, out, result.extra);
          return;
        }
      }
    }
  }
}
