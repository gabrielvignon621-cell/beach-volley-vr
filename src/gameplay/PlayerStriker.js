import * as THREE from 'three';
import { BALL, COURT, NET } from '../config.js';
import { heightAtNet, solveLaunch } from '../physics/trajectory.js';

const MAX_SPEED = 30;
const v1 = new THREE.Vector3();

/**
 * Transforma o contato da mão do jogador num golpe de vôlei.
 * A física dá o golpe "cru" (reflexão + velocidade da mão); depois um assistente
 * puxa a bola na direção de uma jogada útil, com força que depende da dificuldade:
 * - manchete (antebraços juntos): passe alto para o parceiro levantar;
 * - toque (mãos juntas acima da cabeça): levantamento para o parceiro atacar;
 * - cortada (mão aberta, swing rápido): força e direção da mão, só corrige para passar a rede;
 * - toque simples (qualquer outro contato): rebote físico com pouca ajuda.
 */
export class PlayerStriker {
  constructor(rig, actor, context) {
    this.rig = rig;
    this.actor = actor;
    this.context = context; // { assist(), touchIndex(), partnerTarget(kind), opponentTarget(), active() }
    this.frameDt = 1 / 72;
    this.lastSide = 0;
  }

  enabled() {
    return this.context.active() && this.rig.sides.some((s) => s.visible);
  }

  colliders() {
    const list = [];
    for (const side of this.rig.sides) {
      if (!side.visible) continue;
      for (const c of side.colliders) {
        c.side = side.index;
        list.push(c);
      }
    }
    return list;
  }

  resolve(contact) {
    const side = this.rig.sides[contact.collider.side];
    const assist = this.context.assist();
    const touch = this.context.touchIndex(); // 1, 2 ou 3 (próximo toque do time)
    const kind = this.#classify(contact, side);
    const ballVel = contact.ballVelocity;
    const handVel = side.velocity.clone();
    let normal = contact.normal.clone();
    let velocity;
    let spin = new THREE.Vector3();

    if (kind === 'bump') {
      normal = this.rig.platform.normal.clone();
      velocity = this.#reflect(ballVel, handVel, normal, 0.42).addScaledVector(normal, 2.2);
      const ideal = touch >= 3 ? this.#over(contact.ballPosition, 1.5) : this.#toPartner(contact.ballPosition, 'pass');
      velocity = this.#blend(velocity, ideal, assist);
      spin = this.#spinFor(velocity, -6);
    } else if (kind === 'set') {
      const pushDir = this.rig.sides[0].palmNormal.clone().add(this.rig.sides[1].palmNormal).normalize();
      velocity = handVel.clone().multiplyScalar(0.8).addScaledVector(pushDir, 2).add(new THREE.Vector3(0, 3.5, 0));
      const ideal = touch >= 3 ? this.#over(contact.ballPosition, 1.4) : this.#toPartner(contact.ballPosition, 'set');
      velocity = this.#blend(velocity, ideal, Math.min(1, assist + 0.15));
    } else if (kind === 'spike') {
      velocity = handVel.clone().multiplyScalar(1.45).addScaledVector(normal, 1.2).addScaledVector(ballVel, 0.08);
      velocity = this.#clampSpeed(velocity);
      velocity = this.#helpOverNet(contact.ballPosition, velocity, assist * 0.6);
      spin = this.#spinFor(velocity, 28);
    } else {
      velocity = this.#reflect(ballVel, handVel, normal, 0.55).addScaledVector(handVel, 0.5);
      velocity = this.#clampSpeed(velocity);
      if (touch >= 3) velocity = this.#helpOverNet(contact.ballPosition, velocity, assist * 0.5);
    }

    this.rig.feedback(side.index, Math.min(1, velocity.length() / 20));
    this.lastSide = side.index;
    return { kind, velocity, spin, extra: { sideIndex: side.index } };
  }

  #classify(contact, side) {
    const kind = contact.collider.kind;
    if (kind === 'forearm') return this.rig.platform.active ? 'bump' : 'dig';
    if (this.rig.setPose) return 'set';
    if (side.open && side.speed > 3.2) return 'spike';
    if (this.rig.platform.active && contact.ballPosition.y < this.rig.head.y - 0.5) return 'bump';
    return 'hit';
  }

  #reflect(ballVel, handVel, normal, restitution) {
    const rel = v1.subVectors(ballVel, handVel);
    const along = rel.dot(normal);
    const out = rel.clone();
    if (along < 0) out.addScaledVector(normal, -(1 + restitution) * along);
    return out.add(handVel);
  }

  #blend(physical, ideal, k) {
    if (!ideal) return this.#clampSpeed(physical);
    return this.#clampSpeed(physical.clone().lerp(ideal, THREE.MathUtils.clamp(k, 0, 1)));
  }

  #clampSpeed(v) {
    const s = v.length();
    if (s > MAX_SPEED) v.multiplyScalar(MAX_SPEED / s);
    return v;
  }

  #toPartner(from, kind) {
    const target = this.context.partnerTarget(kind);
    if (!target) return null;
    return solveLaunch(from, target.point, target.flight, undefined, new THREE.Vector3());
  }

  #over(from, flight) {
    const target = this.context.opponentTarget();
    const v = solveLaunch(from, target, flight, undefined, new THREE.Vector3());
    const atNet = heightAtNet(from, v);
    if (atNet && atNet.y < NET.topHeight + 0.3) return solveLaunch(from, target, flight + 0.35, undefined, new THREE.Vector3());
    return v;
  }

  /**
   * Cortada: respeita a direção que o jogador deu, mas se a bola fosse bater na rede
   * ou sair muito, corrige parcialmente (proporcional à assistência).
   */
  #helpOverNet(from, velocity, k) {
    if (velocity.z > -1) return velocity; // não está indo para o lado adversário
    const atNet = heightAtNet(from, velocity);
    const clears = atNet && atNet.y > NET.topHeight + BALL.radius + 0.05 && Math.abs(atNet.x) < NET.antennaX;
    const speed = velocity.length();
    // Ponto de queda pretendido: na direção horizontal do golpe, dentro da quadra.
    const dir = new THREE.Vector3(velocity.x, 0, velocity.z).normalize();
    const reach = THREE.MathUtils.clamp((speed / 22) * 9, 3.5, 9);
    const land = new THREE.Vector3(from.x + dir.x * reach, BALL.radius, from.z + dir.z * reach);
    const inside = Math.abs(land.x) < COURT.halfWidth && land.z > -COURT.halfLength && land.z < -0.3;
    if (clears && inside) return velocity;
    land.x = THREE.MathUtils.clamp(land.x, -COURT.halfWidth + 0.5, COURT.halfWidth - 0.5);
    land.z = THREE.MathUtils.clamp(land.z, -COURT.halfLength + 0.6, -1.0);
    let flight = THREE.MathUtils.clamp(from.distanceTo(land) / Math.max(speed, 8), 0.45, 1.6);
    let ideal = solveLaunch(from, land, flight, undefined, new THREE.Vector3());
    for (let i = 0; i < 8; i++) {
      const h = heightAtNet(from, ideal);
      if (h && h.y > NET.topHeight + BALL.radius + 0.1) break;
      flight += 0.1;
      ideal = solveLaunch(from, land, flight, undefined, ideal);
    }
    return velocity.clone().lerp(ideal, THREE.MathUtils.clamp(clears ? k * 0.5 : Math.max(k, 0.45), 0, 1));
  }

  /** Giro em torno do eixo perpendicular ao voo: positivo = topspin. */
  #spinFor(velocity, amount) {
    const dir = new THREE.Vector3(velocity.x, 0, velocity.z);
    if (dir.lengthSq() < 1e-4) return new THREE.Vector3();
    dir.normalize();
    return new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(amount);
  }
}
