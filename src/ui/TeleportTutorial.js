import * as THREE from 'three';
import { CanvasPanel } from './CanvasPanel.js';

const INK = 'rgba(8, 12, 22, 0.92)';
const TEAL = '#2dd4bf';
const TEXT = '#f8fafc';
const MUTED = '#9fb0c8';
const W = 1024;
const H = 640;
const MAX_TIME = 40;

const fwd = new THREE.Vector3();
const goal = new THREE.Vector3();

/**
 * Telinha flutuante que ensina o teleporte (mãos e controles).
 * Segue a cabeça com atraso, some depois do primeiro teleporte ou do tempo limite.
 */
export class TeleportTutorial {
  constructor(scene) {
    this.panel = new CanvasPanel({ width: W, height: H, worldWidth: 0.62 });
    this.panel.mesh.material.depthTest = false;
    this.panel.mesh.renderOrder = 25;
    this.panel.mesh.visible = false;
    scene.add(this.panel.mesh);
    this.life = 0;
    this.closing = 0;
    this.#draw();
  }

  get visible() {
    return this.panel.mesh.visible;
  }

  show(head, headForward) {
    this.life = 0;
    this.closing = 0;
    this.#place(head, headForward, 1);
    this.panel.mesh.visible = true;
  }

  /** Fecha com animação (ex.: depois do primeiro teleporte). */
  done() {
    if (this.visible && !this.closing) this.closing = 0.001;
  }

  hide() {
    this.panel.mesh.visible = false;
  }

  update(dt, head, headForward) {
    if (!this.visible) return;
    this.life += dt;
    if (this.life > MAX_TIME) this.done();
    this.#place(head, headForward, 1 - Math.exp(-dt * 2.5));
    const mesh = this.panel.mesh;
    const appear = 1 - Math.pow(1 - Math.min(1, this.life / 0.3), 3);
    let fade = 1;
    if (this.closing) {
      this.closing += dt;
      fade = Math.max(0, 1 - this.closing / 0.35);
      if (fade <= 0) this.hide();
    }
    mesh.material.opacity = appear * fade;
    mesh.scale.setScalar((0.88 + 0.12 * appear) * (0.9 + 0.1 * fade));
    // Marcador do desenho pulsa (redesenho barato: só 8 quadros por segundo).
    this.#draw(Math.floor(this.life * 8) % 16);
  }

  /** Fica abaixo e à frente da linha do olhar, sem tapar a bola. */
  #place(head, headForward, k) {
    fwd.set(headForward.x, 0, headForward.z);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    goal.copy(head).addScaledVector(fwd, 0.85);
    goal.y = head.y - 0.38;
    this.panel.mesh.position.lerp(goal, k);
    this.panel.mesh.lookAt(head);
  }

  #draw(frame = 0) {
    this.panel.update(`tp|${frame}`, (ctx, p) => {
      p.roundedRect(24, 24, W - 48, H - 48, 48);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(45,212,191,0.55)';
      ctx.stroke();
      ctx.fillStyle = TEAL;
      p.roundedRect(24, 24, W - 48, 12, 6);
      ctx.fill();

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = TEXT;
      p.font(900, 64);
      ctx.fillText('TELEPORTE', 70, 100);
      ctx.fillStyle = MUTED;
      p.font(600, 30);
      ctx.fillText('A bola vem longe? Vá até ela num instante.', 70, 152);

      // Ilustração: mão apontando, arco e alvo no chão.
      const pulse = 0.5 + 0.5 * Math.sin((frame / 16) * Math.PI * 2);
      ctx.save();
      ctx.translate(700, 215);
      ctx.strokeStyle = TEAL;
      ctx.lineWidth = 7;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      ctx.moveTo(40, 40);
      ctx.quadraticCurveTo(150, -60, 230, 120);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.ellipse(230, 130, 40 + pulse * 10, 13 + pulse * 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '84px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👉', 0, 50);
      ctx.restore();

      const step = (n, title, body, y) => {
        ctx.fillStyle = TEAL;
        ctx.beginPath();
        ctx.arc(98, y, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#04201d';
        ctx.textAlign = 'center';
        p.font(900, 32);
        ctx.fillText(String(n), 98, y + 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = TEXT;
        p.font(800, 34);
        ctx.fillText(title, 146, y - 16);
        ctx.fillStyle = MUTED;
        p.font(500, 27);
        ctx.fillText(body, 146, y + 22);
      };
      step(1, 'Aponte o indicador', 'Outros dedos dobrados.', 250);
      step(2, 'Mire no chão', 'Arco verde = pode ir.', 352);
      step(3, 'Abra a mão', 'Você aparece no alvo.', 454);

      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      p.roundedRect(70, 520, W - 140, 72, 20);
      ctx.fill();
      ctx.fillStyle = MUTED;
      p.font(600, 26);
      ctx.textAlign = 'center';
      ctx.fillText('Controles: analógico direito p/ frente, mire e solte  •  Menu: RECENTRAR', W / 2, 557);
    });
  }
}
