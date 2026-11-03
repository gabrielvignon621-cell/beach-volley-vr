import * as THREE from 'three';
import { COURT, PHYSICS } from '../config.js';
import { Athlete } from './Athlete.js';

const STANDING_REACH = 2.35;
const tmp = new THREE.Vector3();

/**
 * Corpo e locomoção de um bot: aceleração limitada, corrida (frontal ou lateral),
 * salto balístico e mergulho. Quem decide para onde ir e o que fazer é o BotDirector.
 */
export class Bot {
  constructor(scene, { id, name, team, sign, jersey, skin, hair, number, isPartner = false }) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.sign = sign;
    this.isHuman = false;
    this.isPartner = isPartner;
    this.athlete = new Athlete(scene, { jersey, skin, hair, number, name });
    this.position = new THREE.Vector3(0, 0, sign * 5);
    this.velocity = new THREE.Vector3();
    this.facing = sign > 0 ? Math.PI : 0;
    this.target = this.position.clone();
    this.lookAt = new THREE.Vector3(0, 1, 0);
    this.arms = 'ready';
    this.urgency = 1;
    this.delay = 0;
    this.plan = null;
    this.jump = { active: false, t: 0, v0: 0, height: 0 };
    this.dive = { active: false, t: 0, dir: new THREE.Vector3() };
    this.pose = 'ready';
    this.poseTimer = 0;
    this.blocking = false;
    this.label = null;
  }

  get head() {
    return tmp.set(this.position.x, 1.75 + this.jump.height, this.position.z);
  }

  /** Alcance da mão em pé + salto. */
  static reach(jumpHeight) {
    return STANDING_REACH + jumpHeight;
  }

  moveTo(point, { urgency = 1, delay = 0 } = {}) {
    this.target.set(point.x, 0, point.z);
    this.urgency = urgency;
    this.delay = Math.max(this.delay, delay);
  }

  /** Salto com tempo até o pico `timeToApex` (s). */
  startJump(height) {
    if (this.jump.active || this.dive.active) return;
    const g = -PHYSICS.gravity;
    this.jump.active = true;
    this.jump.t = 0;
    this.jump.v0 = Math.sqrt(2 * g * height);
    this.jump.height = 0;
  }

  static timeToApex(height) {
    return Math.sqrt((2 * height) / -PHYSICS.gravity);
  }

  startDive(direction) {
    if (this.dive.active || this.jump.active) return;
    this.dive.active = true;
    this.dive.t = 0;
    this.dive.dir.copy(direction).setY(0).normalize();
    this.velocity.addScaledVector(this.dive.dir, 3.2);
  }

  setPose(name, hold = 0) {
    this.pose = name;
    this.poseTimer = hold;
  }

  update(dt, difficulty) {
    if (dt <= 0) return;
    this.delay = Math.max(0, this.delay - dt);
    this.poseTimer = Math.max(0, this.poseTimer - dt);

    // Locomoção: acelera até a velocidade máxima, freia perto do alvo.
    const maxSpeed = difficulty.runSpeed * this.urgency;
    const accel = difficulty.accel;
    if (!this.dive.active) {
      const desired = new THREE.Vector3();
      if (this.delay <= 0) {
        desired.subVectors(this.target, this.position).setY(0);
        const dist = desired.length();
        const arrive = Math.min(maxSpeed, Math.sqrt(2 * accel * 0.8 * dist));
        if (dist > 0.02) desired.multiplyScalar(arrive / dist);
        else desired.set(0, 0, 0);
      }
      const dv = desired.sub(this.velocity);
      const maxDv = accel * dt * (this.jump.active ? 0.15 : 1);
      if (dv.length() > maxDv) dv.setLength(maxDv);
      this.velocity.add(dv);
    } else {
      // Mergulho: desliza e perde velocidade na areia.
      this.dive.t += dt;
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.4));
      if (this.dive.t > 1.15) this.dive.active = false;
    }
    this.position.addScaledVector(this.velocity, dt);

    // Cada time fica no seu lado; ninguém invade a rede.
    const zMin = 0.35;
    const zMax = COURT.halfLength + 3.5;
    const zs = THREE.MathUtils.clamp(this.position.z * this.sign, zMin, zMax);
    this.position.z = zs * this.sign;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -COURT.halfWidth - 3, COURT.halfWidth + 3);

    // Salto balístico.
    if (this.jump.active) {
      this.jump.t += dt;
      const g = -PHYSICS.gravity;
      this.jump.height = this.jump.v0 * this.jump.t - 0.5 * g * this.jump.t * this.jump.t;
      if (this.jump.height <= 0 && this.jump.t > 0.05) {
        this.jump.active = false;
        this.jump.height = 0;
      }
    }

    this.#animate(dt);
  }

  #animate(dt) {
    const a = this.athlete;
    const p = a.pose;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);

    // Vira para onde olha (bola ou rede); corre de lado se o movimento for lateral.
    const look = Math.atan2(this.lookAt.x - this.position.x, this.lookAt.z - this.position.z);
    let diff = look - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * Math.min(1, dt * 8);

    const forward = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const vf = this.velocity.dot(forward);
    const vr = this.velocity.dot(right);

    p.runAmount = THREE.MathUtils.clamp(speed / 4.5, 0, 1);
    p.runPhase += dt * (4 + speed * 2.1) * (vf < -0.3 ? -1 : 1);
    p.strafe = THREE.MathUtils.clamp(vr / 4, -1, 1);
    p.jump = this.jump.height;
    p.dive = this.dive.active ? Math.min(1, this.dive.t * 5) * (this.dive.t < 0.8 ? 1 : Math.max(0, 1 - (this.dive.t - 0.8) * 3)) : 0;

    const pose = this.pose;
    p.arms = pose === 'move' ? 'ready' : pose;
    p.crouch = { ready: 0.42, bump: 0.6, set: 0.22, block: 0.05, spikeLoad: 0.1, spikeSwing: 0.1, idle: 0.08, toss: 0.12, celebrate: 0.05, sad: 0.1, dive: 0.5 }[p.arms] ?? 0.35;
    if (this.jump.active) p.crouch = 0.05;
    p.lean = p.arms === 'sad' ? 0.35 : 0.08;

    a.root.position.set(this.position.x, 0, this.position.z);
    a.root.rotation.y = this.facing;
    a.update(dt);
  }

  /** Ponto de contato atual do braço/mão para cada tipo de golpe (mundo). */
  contactPoint(kind, out = new THREE.Vector3()) {
    const f = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (kind === 'bump' || kind === 'dig') return out.copy(this.position).addScaledVector(f, 0.42).setY(0.8);
    if (kind === 'set') return out.copy(this.position).addScaledVector(f, 0.15).setY(2.25);
    return out.copy(this.position).addScaledVector(f, 0.25).setY(STANDING_REACH + this.jump.height);
  }
}
