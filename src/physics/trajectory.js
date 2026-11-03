import { Vector3 } from 'three';
import { BALL, NET, PHYSICS } from '../config.js';
import { aeroAcceleration } from './aero.js';

const acc = { x: 0, y: 0, z: 0 };
const ZERO = { x: 0, y: 0, z: 0 };

/**
 * Integra a trajetória da bola no ar com o mesmo passo e o mesmo modelo da física.
 * Para quando a bola toca o chão ou ao atingir `maxTime`.
 * Retorna amostras { t, x, y, z, vx, vy, vz } espaçadas de `sampleEvery` segundos.
 */
export function predictTrajectory(p0, v0, spin = ZERO, { maxTime = 5, sampleEvery = 1 / 60, groundY = BALL.radius } = {}) {
  const dt = PHYSICS.step;
  const p = { x: p0.x, y: p0.y, z: p0.z };
  const v = { x: v0.x, y: v0.y, z: v0.z };
  const samples = [{ t: 0, ...p, vx: v.x, vy: v.y, vz: v.z }];
  let t = 0;
  let nextSample = sampleEvery;

  while (t < maxTime) {
    aeroAcceleration(v, spin, acc);
    v.x += acc.x * dt;
    v.y += (acc.y + PHYSICS.gravity) * dt;
    v.z += acc.z * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    t += dt;

    if (p.y <= groundY) {
      samples.push({ t, ...p, vx: v.x, vy: v.y, vz: v.z, landed: true });
      break;
    }
    if (t >= nextSample) {
      samples.push({ t, ...p, vx: v.x, vy: v.y, vz: v.z });
      nextSample += sampleEvery;
    }
  }
  return samples;
}

/** Posição da bola após `time` segundos (sem considerar colisões). */
export function positionAfter(p0, v0, spin, time, out = new Vector3()) {
  const dt = PHYSICS.step;
  const p = { x: p0.x, y: p0.y, z: p0.z };
  const v = { x: v0.x, y: v0.y, z: v0.z };
  const steps = Math.round(time / dt);
  for (let i = 0; i < steps; i++) {
    aeroAcceleration(v, spin, acc);
    v.x += acc.x * dt;
    v.y += (acc.y + PHYSICS.gravity) * dt;
    v.z += acc.z * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
  }
  return out.set(p.x, p.y, p.z);
}

/**
 * Resolve a velocidade inicial para a bola sair de `from` e passar por `target`
 * depois de `flightTime` segundos, já compensando arrasto e Magnus (método do tiro).
 */
export function solveLaunch(from, target, flightTime, spin = ZERO, out = new Vector3()) {
  const g = PHYSICS.gravity;
  const T = flightTime;
  out.set(
    (target.x - from.x) / T,
    (target.y - from.y - 0.5 * g * T * T) / T,
    (target.z - from.z) / T,
  );
  const reached = new Vector3();
  for (let i = 0; i < 8; i++) {
    positionAfter(from, out, spin, T, reached);
    const ex = target.x - reached.x;
    const ey = target.y - reached.y;
    const ez = target.z - reached.z;
    out.x += ex / T;
    out.y += ey / T;
    out.z += ez / T;
    if (Math.abs(ex) + Math.abs(ey) + Math.abs(ez) < 0.005) break;
  }
  return out;
}

/** Altura da bola ao cruzar o plano da rede (z = 0), ou null se não cruzar. */
export function heightAtNet(from, velocity, spin = ZERO) {
  const samples = predictTrajectory(from, velocity, spin, { sampleEvery: PHYSICS.step });
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (Math.sign(a.z) !== Math.sign(b.z)) {
      const k = a.z / (a.z - b.z);
      return { y: a.y + (b.y - a.y) * k, x: a.x + (b.x - a.x) * k };
    }
  }
  return null;
}

export const NET_CLEARANCE = NET.topHeight + BALL.radius;
