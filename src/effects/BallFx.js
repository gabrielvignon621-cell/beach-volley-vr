import * as THREE from 'three';
import { BALL } from '../config.js';

const TRAIL = 14;
const RINGS = 6;

/**
 * Efeitos da bola:
 * - rastro (cometa) quando a bola passa de 13 m/s: cortadas e saques fortes;
 * - anel de impacto no ponto de contato, em pool.
 */
export class BallFx {
  constructor(scene) {
    this.trailMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BALL.radius, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.22, depthWrite: false }),
      TRAIL,
    );
    this.trailMesh.frustumCulled = false;
    this.trailMesh.count = 0;
    scene.add(this.trailMesh);
    this.history = [];

    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.7, 1, 40);
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 0.35, scale: 0.3 });
    }
    this.nextRing = 0;
    this.m = new THREE.Matrix4();
  }

  impact(position, color = 0xffffff, size = 0.35) {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % RINGS;
    r.mesh.position.copy(position);
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
    r.life = r.max;
    r.scale = size;
  }

  update(dt, ball, cameraPosition) {
    const speed = ball.velocity.length();
    if (ball.mesh.visible && speed > 13 && !ball.parked) this.history.unshift(ball.mesh.position.clone());
    else if (this.history.length) this.history.pop();
    if (this.history.length > TRAIL) this.history.length = TRAIL;
    const n = this.history.length;
    for (let i = 0; i < n; i++) {
      const s = 1 - i / TRAIL;
      this.m.makeScale(s, s, s).setPosition(this.history[i]);
      this.trailMesh.setMatrixAt(i, this.m);
    }
    this.trailMesh.count = n;
    this.trailMesh.instanceMatrix.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      const t = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.scale * (0.4 + t * 1.2));
      r.mesh.material.opacity = (1 - t) * 0.85;
      r.mesh.lookAt(cameraPosition);
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  clearTrail() {
    this.history.length = 0;
    this.trailMesh.count = 0;
  }
}
