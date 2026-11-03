import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALL, COURT, NET } from '../config.js';
import { heightAtNet, solveLaunch } from '../physics/trajectory.js';

const MIN_NET_MARGIN = 0.35;

/**
 * Lançador de bolas no fundo da quadra adversária. Serve para testar a física
 * nesta fase e, depois, como modo de treino. Usa o mesmo solucionador de trajetória
 * que os bots vão usar: mira um ponto e um tempo de voo, garantindo que a bola passa a rede.
 */
export class BallMachine {
  constructor(scene, ball) {
    this.ball = ball;
    this.group = new THREE.Group();
    this.group.position.set(0, 0, -COURT.halfLength - 0.9);
    this.head = new THREE.Group();
    this.head.position.y = 1.55;
    this.recoil = 0;

    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2430, metalness: 0.55, roughness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.45 });

    const legs = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const foot = new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
      const top = new THREE.Vector3(0, 1.4, 0);
      const dir = new THREE.Vector3().subVectors(top, foot);
      const g = new THREE.CylinderGeometry(0.025, 0.03, dir.length(), 6).translate(0, dir.length() / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
      g.translate(foot.x, 0, foot.z);
      legs.push(g);
    }
    legs.push(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10).translate(0, 1.4, 0));
    this.group.add(new THREE.Mesh(mergeGeometries(legs), dark));

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.5), dark);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.51), accent);
    band.position.y = 0.06;
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.55, 18, 1, true).rotateX(Math.PI / 2), dark);
    this.barrel.position.set(0, 0.1, 0.4);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.02, 8, 24), accent);
    muzzle.position.set(0, 0.1, 0.68);
    this.head.add(body, band, this.barrel, muzzle);
    this.group.add(this.head);
    scene.add(this.group);

    this.muzzleLocal = new THREE.Vector3(0, 0.1, 0.8);
  }

  muzzlePosition(out = new THREE.Vector3()) {
    this.head.updateWorldMatrix(true, false);
    return out.copy(this.muzzleLocal).applyMatrix4(this.head.matrixWorld);
  }

  /** Saca na direção de `target` (alvo na altura dos antebraços), com float ou topspin. */
  serveTo(target, { topspin = Math.random() < 0.45 } = {}) {
    const aim = new THREE.Vector3(
      THREE.MathUtils.clamp(target.x + (Math.random() - 0.5) * 1.2, -COURT.halfWidth + 0.4, COURT.halfWidth - 0.4),
      0.95,
      THREE.MathUtils.clamp(target.z + (Math.random() - 0.5) * 1.0, 1.5, COURT.halfLength + 1.5),
    );
    this.head.lookAt(aim.x, this.head.getWorldPosition(new THREE.Vector3()).y + 0.6, aim.z);
    const from = this.muzzlePosition();

    // Topspin gira em torno do eixo perpendicular à direção do saque e "mergulha" a bola.
    const dir = new THREE.Vector3(aim.x - from.x, 0, aim.z - from.z).normalize();
    const spinAxis = new THREE.Vector3(dir.z, 0, -dir.x);
    // Com eixo (d.z, 0, -d.x), w x v aponta para baixo: topspin de verdade.
    const spin = topspin ? spinAxis.multiplyScalar(22 + Math.random() * 10) : new THREE.Vector3();

    let flight = topspin ? 1.25 : 1.45 + Math.random() * 0.2;
    const velocity = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      solveLaunch(from, aim, flight, spin, velocity);
      const atNet = heightAtNet(from, velocity, spin);
      if (atNet && atNet.y > NET.topHeight + BALL.radius + MIN_NET_MARGIN) break;
      flight += 0.08;
    }
    this.ball.launch(from, velocity, spin);
    this.recoil = 1;
    return { velocity, spin, flight };
  }

  update(dt) {
    if (this.recoil <= 0) return;
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.barrel.position.z = 0.4 - Math.sin(this.recoil * Math.PI) * 0.08;
  }
}
