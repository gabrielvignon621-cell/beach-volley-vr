import * as THREE from 'three';
import { CanvasPanel } from './CanvasPanel.js';
import { COURT, PLAYER, TEAMS } from '../config.js';

const INK = 'rgba(8, 12, 22, 0.92)';
const EDGE = 'rgba(255,255,255,0.14)';
const TEXT = '#f8fafc';
const MUTED = '#9fb0c8';
const SUN = '#ffb35c';

/** Placar gigante atrás da quadra adversária, virado para o jogador. */
export class Scoreboard {
  constructor(scene) {
    this.panel = new CanvasPanel({ width: 1024, height: 512, worldWidth: 5.2 });
    this.panel.mesh.material.depthWrite = true;
    this.panel.mesh.material.transparent = false;
    this.panel.mesh.renderOrder = 0;
    const group = new THREE.Group();
    group.position.set(0, 0, -COURT.halfLength - 9.6);
    this.panel.mesh.position.y = 6.2;
    group.add(this.panel.mesh);

    // Estrutura: dois postes e moldura.
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a3340, metalness: 0.6, roughness: 0.45 });
    for (const x of [-2.2, 2.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5, 0.16), metal);
      post.position.set(x, 2.5, -0.1);
      group.add(post);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.45, 2.75, 0.12), metal);
    frame.position.set(0, 6.2, -0.08);
    group.add(frame);
    scene.add(group);
    this.group = group;
    this.update({ score: { A: 0, B: 0 }, sets: { A: 0, B: 0 }, serving: null, setIndex: 0, bestOf: 1, label: 'TREINO' });
  }

  update(s) {
    const sig = JSON.stringify(s);
    this.panel.update(sig, (ctx, p) => {
      const W = 1024;
      const H = 512;
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(255,179,92,0.10)');
      g.addColorStop(1, 'rgba(45,212,191,0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      p.font(700, 30);
      ctx.fillText(s.label ?? `SET ${s.setIndex + 1}${s.bestOf > 1 ? ` DE ${s.bestOf}` : ''}`, W / 2, 52);

      const cols = [
        { team: 'A', x: W * 0.27 },
        { team: 'B', x: W * 0.73 },
      ];
      for (const { team, x } of cols) {
        const meta = TEAMS[team];
        ctx.fillStyle = meta.accent;
        p.roundedRect(x - 170, 92, 340, 8, 4);
        ctx.fill();
        ctx.fillStyle = TEXT;
        p.font(800, 40);
        ctx.fillText(team === 'A' ? (s.teamA ?? 'VOCÊ + DUDA') : 'RAFA + LÉO', x, 140);
        p.font(900, 230);
        ctx.fillText(String(s.score[team]).padStart(2, '0'), x, 320);
        if (s.bestOf > 1) {
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(x - 22 + i * 44, 455, 13, 0, Math.PI * 2);
            ctx.fillStyle = i < s.sets[team] ? meta.accent : 'rgba(255,255,255,0.14)';
            ctx.fill();
          }
        }
        if (s.serving === team) {
          ctx.fillStyle = SUN;
          ctx.beginPath();
          ctx.arc(x + 170, 140, 14, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(W / 2 - 2, 120, 4, 300);
    });
  }
}

/**
 * Faixa de mensagens grandes ("PONTO!", "SAQUE", "FIM DE JOGO") sobre a rede.
 * Aparece com escala e some sozinha.
 */
export class Banner {
  constructor(scene) {
    this.panel = new CanvasPanel({ width: 1024, height: 320, worldWidth: 3.4 });
    this.panel.mesh.position.set(0, 4.1, -0.6);
    this.panel.mesh.material.depthTest = false;
    this.panel.mesh.renderOrder = 20;
    scene.add(this.panel.mesh);
    this.life = 0;
    this.duration = 0;
    this.panel.mesh.visible = false;
  }

  show(title, subtitle = '', { color = SUN, duration = 2.2 } = {}) {
    this.life = 0;
    this.duration = duration;
    this.panel.mesh.visible = true;
    this.panel.update(`${title}|${subtitle}|${color}|${Math.random()}`, (ctx, p) => {
      const W = 1024;
      const H = 320;
      p.roundedRect(40, 40, W - 80, H - 80, 60);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = EDGE;
      ctx.stroke();
      ctx.fillStyle = color;
      p.roundedRect(40, 40, W - 80, 10, 5);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = TEXT;
      p.font(900, subtitle ? 104 : 120);
      ctx.fillText(title, W / 2, subtitle ? 140 : H / 2);
      if (subtitle) {
        ctx.fillStyle = MUTED;
        p.font(600, 40);
        ctx.fillText(subtitle, W / 2, 222);
      }
    });
  }

  update(dt, cameraPosition) {
    if (!this.panel.mesh.visible) return;
    this.life += dt;
    const t = this.life;
    const inT = Math.min(1, t / 0.22);
    const outT = Math.max(0, (t - (this.duration - 0.35)) / 0.35);
    const ease = 1 - Math.pow(1 - inT, 3);
    const s = (0.85 + ease * 0.15) * (1 - outT * 0.1);
    this.panel.mesh.scale.setScalar(s);
    this.panel.mesh.material.opacity = ease * (1 - outT);
    this.panel.mesh.lookAt(cameraPosition.x, this.panel.mesh.position.y, cameraPosition.z);
    if (t >= this.duration) this.panel.mesh.visible = false;
  }
}

/**
 * Relógio no pulso esquerdo: placar compacto + botão MENU (encoste o indicador direito).
 * Com controles, fica preso ao controle esquerdo.
 */
export class WristWatch {
  constructor(scene) {
    this.panel = new CanvasPanel({ width: 384, height: 256, worldWidth: 0.075 });
    this.panel.mesh.material.depthTest = true;
    scene.add(this.panel.mesh);
    this.panel.mesh.visible = false;
    this.button = new THREE.Vector3();
    this.hover = false;
    this.cooldown = 0;
    this.normal = new THREE.Vector3();
    this.state = { a: 0, b: 0, label: 'TREINO' };
  }

  setState(state) {
    this.state = state;
  }

  /** Posiciona no pulso e testa o toque. Retorna true quando o botão foi apertado. */
  update(dt, rig) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const left = rig.sides.find((s) => s.handedness === 'left' && s.visible);
    const right = rig.sides.find((s) => s.handedness === 'right' && s.visible);
    const mesh = this.panel.mesh;
    if (!left) {
      mesh.visible = false;
      return false;
    }
    mesh.visible = true;
    // Face do relógio: lado de fora do pulso (oposto à palma), um pouco antes da mão.
    this.normal.copy(left.palmNormal).negate();
    mesh.position.copy(left.wrist).addScaledVector(left.forearmDir, 0.06).addScaledVector(this.normal, 0.03);
    const up = left.forearmDir.clone().negate();
    const m = new THREE.Matrix4().lookAt(mesh.position.clone().add(this.normal), mesh.position, up);
    mesh.quaternion.setFromRotationMatrix(m);

    let pressed = false;
    this.hover = false;
    if (right && right.mode === 'hand') {
      const tip = right.tips[1];
      const d = tip.distanceTo(mesh.position);
      this.hover = d < 0.06;
      if (d < 0.028 && this.cooldown <= 0) {
        pressed = true;
        this.cooldown = 1;
      }
    }

    const s = this.state;
    this.panel.update(`${s.a}|${s.b}|${s.label}|${this.hover}`, (ctx, p) => {
      p.roundedRect(6, 6, 372, 244, 40);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = this.hover ? SUN : EDGE;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = MUTED;
      p.font(700, 26);
      ctx.fillText(s.label, 192, 42);
      ctx.fillStyle = TEXT;
      p.font(900, 84);
      ctx.fillText(`${s.a}  ·  ${s.b}`, 192, 118);
      p.roundedRect(92, 172, 200, 54, 27);
      ctx.fillStyle = this.hover ? SUN : 'rgba(255,255,255,0.12)';
      ctx.fill();
      ctx.fillStyle = this.hover ? '#1a0d06' : TEXT;
      p.font(800, 28);
      ctx.fillText('MENU', 192, 200);
    });
    return pressed;
  }
}

/** Placa leve de nome sobre cada bot. */
export function createNameTag(text, color) {
  const panel = new CanvasPanel({ width: 256, height: 64, worldWidth: 0.5 });
  panel.update(text, (ctx, p) => {
    p.roundedRect(4, 4, 248, 56, 28);
    ctx.fillStyle = 'rgba(8,12,22,0.7)';
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(34, 32, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TEXT;
    p.font(700, 30);
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 56, 33);
  });
  return panel.mesh;
}

export const HUD_DEFAULT_SPAWN = PLAYER.spawn;
