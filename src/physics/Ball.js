import * as THREE from 'three';
import { BALL } from '../config.js';
import { RAPIER } from './PhysicsWorld.js';
import { aeroAcceleration } from './aero.js';
import { createVolleyballTexture, createBlobShadowTexture } from '../world/textures.js';

const SAND_GRIP = 0.62;
const acc = { x: 0, y: 0, z: 0 };

/**
 * Bola de vôlei: corpo Rapier com CCD (não atravessa mãos nem rede),
 * arrasto e Magnus aplicados a cada passo e render interpolado.
 */
export class Ball {
  constructor(physics, scene, bus) {
    this.physics = physics;
    this.bus = bus;

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 1.2, 4)
        .setCcdEnabled(true)
        .setAngularDamping(0.04)
        .setCanSleep(false),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL.radius)
        .setMass(BALL.mass)
        .setRestitution(0.68)
        .setFriction(0.6)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    this.previous = new THREE.Vector3();
    this.current = new THREE.Vector3();
    this.previousQuat = new THREE.Quaternion();
    this.currentQuat = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.lastAirVelocity = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.parked = false;
    this.onSand = false;
    this.flash = 0;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 40, 24),
      new THREE.MeshStandardMaterial({
        map: createVolleyballTexture(),
        roughness: 0.52,
        metalness: 0,
      }),
    );
    this.mesh.name = 'ball';
    scene.add(this.mesh);

    // Sombra de contato projetada para baixo: essencial para ler a altura da bola em VR.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: createBlobShadowTexture(),
        transparent: true,
        depthWrite: false,
        color: 0x3a2410,
      }),
    );
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    physics.preStep.push((dt) => this.#applyAerodynamics(dt));
    physics.postStep.push(() => this.#capture());
    physics.contactListeners.push((h1, h2) => this.#onContact(h1, h2));

    this.#syncFromBody();
  }

  get position() {
    return this.current;
  }

  /** Lança a bola de `position` com `velocity` (m/s) e `spin` (rad/s). */
  launch(position, velocity, spin = { x: 0, y: 0, z: 0 }) {
    this.parked = false;
    this.holdHittable = false;
    this.onSand = false;
    this.body.setGravityScale(1, true);
    this.body.setLinearDamping(0);
    this.body.setAngularDamping(0.04);
    this.body.setTranslation(position, true);
    this.body.setLinvel(velocity, true);
    this.body.setAngvel(spin, true);
    this.#syncFromBody();
    this.bus.emit('ball:launch', { position: this.current.clone(), velocity: new THREE.Vector3().copy(velocity) });
  }

  /** Golpe: troca a velocidade sem teletransportar (mãos, bots, bloqueio). */
  strike(velocity, spin = { x: 0, y: 0, z: 0 }, position = null) {
    this.parked = false;
    this.holdHittable = false;
    this.onSand = false;
    this.body.setGravityScale(1, true);
    this.body.setLinearDamping(0);
    this.body.setAngularDamping(0.04);
    if (position) this.body.setTranslation(position, true);
    this.body.setLinvel(velocity, true);
    this.body.setAngvel(spin, true);
    this.velocity.set(velocity.x, velocity.y, velocity.z);
    this.lastAirVelocity.copy(this.velocity);
    this.flash = 1;
  }

  /** Mantém a bola flutuando num ponto que pode se mover (bola de saque na mão). */
  hold(position) {
    if (!this.parked) this.park(position);
    this.holdHittable = true;
    this.body.setTranslation(position, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this.shadow.visible = visible;
  }

  /** Estado atual para previsão de trajetória. */
  snapshot() {
    const v = this.body.linvel();
    const w = this.body.angvel();
    return {
      position: this.current.clone(),
      velocity: new THREE.Vector3(v.x, v.y, v.z),
      spin: new THREE.Vector3(w.x, w.y, w.z),
    };
  }

  /** Deixa a bola flutuando parada, girando devagar (bola "no tee"). */
  park(position) {
    this.parked = true;
    this.holdHittable = false;
    this.onSand = false;
    this.body.setGravityScale(0, true);
    this.body.setTranslation(position, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0.8, z: 0 }, true);
    this.#syncFromBody();
  }

  /** Atualiza a malha interpolando entre os dois últimos passos físicos. */
  render(alpha, dt = 0) {
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.mesh.material.emissive.setRGB(1, 0.75, 0.35).multiplyScalar(this.flash * 0.55);
    this.mesh.position.lerpVectors(this.previous, this.current, alpha);
    this.mesh.quaternion.slerpQuaternions(this.previousQuat, this.currentQuat, alpha);

    const height = Math.max(this.mesh.position.y - BALL.radius, 0);
    const size = 0.3 + height * 0.05;
    this.shadow.position.set(this.mesh.position.x, 0.004, this.mesh.position.z);
    this.shadow.scale.setScalar(size);
    this.shadow.material.opacity = THREE.MathUtils.clamp(0.62 - height * 0.045, 0.16, 0.62);
  }

  #applyAerodynamics(dt) {
    if (this.parked) return;
    const v = this.body.linvel();
    if (this.onSand && Math.abs(v.y) < 0.6) return;
    const w = this.body.angvel();
    aeroAcceleration(v, w, acc);
    const m = BALL.mass * dt;
    this.body.applyImpulse({ x: acc.x * m, y: acc.y * m, z: acc.z * m }, true);
    this.lastAirVelocity.set(v.x, v.y, v.z);
  }

  #capture() {
    this.previous.copy(this.current);
    this.previousQuat.copy(this.currentQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.current.set(t.x, t.y, t.z);
    this.currentQuat.set(r.x, r.y, r.z, r.w);
    this.velocity.set(v.x, v.y, v.z);

    // Segurança: se algo empurrar a bola para fora do mundo, recoloca em jogo.
    if (t.y < -4 || Math.abs(t.x) > 150 || Math.abs(t.z) > 150) {
      this.bus.emit('ball:lost', {});
    }
  }

  #syncFromBody() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.current.set(t.x, t.y, t.z);
    this.previous.copy(this.current);
    this.currentQuat.set(r.x, r.y, r.z, r.w);
    this.previousQuat.copy(this.currentQuat);
    this.velocity.set(0, 0, 0);
  }

  #onContact(h1, h2) {
    const mine = this.collider.handle;
    if (h1 !== mine && h2 !== mine) return;
    const other = h1 === mine ? h2 : h1;
    const surface = this.physics.surfaceOf(other) ?? 'unknown';
    const speed = this.lastAirVelocity.length();

    if (surface === 'sand') {
      // A areia rouba velocidade horizontal e giro; quando a bola perde força, ela para.
      const v = this.body.linvel();
      const w = this.body.angvel();
      this.body.setLinvel({ x: v.x * SAND_GRIP, y: v.y, z: v.z * SAND_GRIP }, true);
      this.body.setAngvel({ x: w.x * 0.4, y: w.y * 0.4, z: w.z * 0.4 }, true);
      if (speed < 3.5) {
        this.onSand = true;
        this.body.setLinearDamping(3.5);
        this.body.setAngularDamping(3);
      }
    }

    this.bus.emit('ball:contact', {
      surface,
      position: this.current.clone(),
      speed,
      velocity: this.lastAirVelocity.clone(),
    });
  }
}
