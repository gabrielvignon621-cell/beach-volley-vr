import { BALL, PHYSICS } from '../config.js';

const AREA = Math.PI * BALL.radius * BALL.radius;
const DRAG_PER_MASS = (0.5 * PHYSICS.airDensity * PHYSICS.dragCoefficient * AREA) / BALL.mass;
const MAGNUS_PER_MASS = (PHYSICS.magnusCoefficient * PHYSICS.airDensity * BALL.radius ** 3) / BALL.mass;

/**
 * Aceleração aerodinâmica da bola (arrasto quadrático + efeito Magnus), sem a gravidade.
 * É o mesmo modelo usado pela simulação Rapier e pela previsão de trajetória,
 * então o que os bots preveem bate com o que a física executa.
 */
export function aeroAcceleration(v, w, out) {
  const speed = Math.hypot(v.x, v.y, v.z);
  const drag = -DRAG_PER_MASS * speed;
  out.x = drag * v.x + MAGNUS_PER_MASS * (w.y * v.z - w.z * v.y);
  out.y = drag * v.y + MAGNUS_PER_MASS * (w.z * v.x - w.x * v.z);
  out.z = drag * v.z + MAGNUS_PER_MASS * (w.x * v.y - w.y * v.x);
  return out;
}
