import * as THREE from 'three';
import { Athlete } from '../bots/Athlete.js';

const RATE = 1 / 45;
const SECONDS = 6;
const FRAMES = Math.ceil(SECONDS / RATE);

/**
 * Replay em câmera lenta dos lances de destaque.
 * Grava ~6 s (bola + atletas) em buffer circular e, no fim do ponto,
 * reproduz os últimos segundos a 40% da velocidade, com rastro.
 */
export class Replay {
  constructor(ball, getAthletes) {
    this.ball = ball;
    this.getAthletes = getAthletes;
    this.frames = [];
    this.timer = 0;
    this.playing = false;
    this.cursor = 0;
    this.speed = 0.4;
    this.window = 2.6;
  }

  reset() {
    this.frames.length = 0;
  }

  record(dt) {
    if (this.playing) return;
    this.timer += dt;
    if (this.timer < RATE) return;
    this.timer = 0;
    const data = [];
    const athletes = this.getAthletes();
    for (const a of athletes) a.capture(data);
    this.frames.push({
      ball: this.ball.mesh.position.clone(),
      quat: this.ball.mesh.quaternion.clone(),
      visible: this.ball.mesh.visible,
      athletes: Float32Array.from(data),
    });
    if (this.frames.length > FRAMES) this.frames.shift();
  }

  /** Duração real (s) do replay que vai tocar. */
  start() {
    const count = Math.min(this.frames.length, Math.ceil(this.window / RATE));
    if (count < 10) return 0;
    this.clip = this.frames.slice(-count);
    this.playing = true;
    this.cursor = 0;
    return (count * RATE) / this.speed;
  }

  stop() {
    this.playing = false;
    this.clip = null;
  }

  /** Avança e aplica o quadro. Retorna false quando terminar. */
  update(dt) {
    if (!this.playing) return false;
    this.cursor += (dt * this.speed) / RATE;
    const clip = this.clip;
    const i = Math.floor(this.cursor);
    if (i >= clip.length - 1) {
      this.stop();
      return false;
    }
    const a = clip[i];
    const b = clip[i + 1];
    const t = this.cursor - i;
    this.ball.mesh.position.lerpVectors(a.ball, b.ball, t);
    this.ball.mesh.quaternion.slerpQuaternions(a.quat, b.quat, t);
    this.ball.mesh.visible = a.visible;
    this.ball.shadow.position.set(this.ball.mesh.position.x, 0.004, this.ball.mesh.position.z);

    const athletes = this.getAthletes();
    const blended = new Float32Array(a.athletes.length);
    for (let k = 0; k < blended.length; k++) blended[k] = a.athletes[k] + (b.athletes[k] - a.athletes[k]) * t;
    athletes.forEach((ath, n) => {
      ath.restore(blended, n * Athlete.CAPTURE_SIZE);
      ath.applyRestored();
      ath.shadow.position.set(ath.root.position.x, 0.005, ath.root.position.z);
    });
    return true;
  }
}

export const REPLAY_TRAIL_COLOR = new THREE.Color(0xffd9a0);
