import * as THREE from 'three';
import { CanvasPanel } from './CanvasPanel.js';

const W = 1100;
const H = 760;
const C = {
  ink: 'rgba(9, 14, 26, 0.96)',
  edge: 'rgba(255,255,255,0.14)',
  text: '#f8fafc',
  muted: '#a7b4c8',
  faint: 'rgba(255,255,255,0.07)',
  hover: 'rgba(255,255,255,0.16)',
  sun: '#ffb35c',
  coral: '#ff6b4a',
};

const raycaster = new THREE.Raycaster();
const tmpLocal = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

/**
 * Menu flutuante em VR. Três formas de usar, todas com a mesma lógica de botão:
 * encostar o indicador (poke), apontar com o raio da mão e fazer pinça, ou apontar
 * com o controle e apertar o gatilho.
 */
export class VRMenu {
  constructor(scene, rig, bus) {
    this.rig = rig;
    this.bus = bus;
    this.panel = new CanvasPanel({ width: W, height: H, worldWidth: 1.1 });
    this.panel.mesh.material.depthTest = false;
    this.panel.mesh.renderOrder = 30;
    this.panel.mesh.visible = false;
    scene.add(this.panel.mesh);
    this.page = 'main';
    this.data = {};
    this.buttons = [];
    this.hoverId = null;
    this.pokeArmed = [true, true];
    this.cooldown = 0;

    // Raios e cursores para apontar.
    this.rays = rig.controllers.map((controller) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }));
      line.renderOrder = 31;
      line.visible = false;
      controller.add(line);
      const cursor = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.011, 24), new THREE.MeshBasicMaterial({ color: 0xffb35c, depthTest: false }));
      cursor.renderOrder = 32;
      cursor.visible = false;
      scene.add(cursor);
      return { controller, line, cursor, hover: null };
    });

    bus.on('xr:select', ({ index }) => {
      if (!this.open) return;
      const ray = this.rays[index];
      if (ray?.hover) this.#press(ray.hover);
    });
  }

  get open() {
    return this.panel.mesh.visible;
  }

  /** Abre a página na frente do jogador. data: estado mostrado (dificuldade, formato...). */
  show(page, data, head, forward) {
    this.page = page;
    this.data = data;
    const flat = forward.clone().setY(0).normalize();
    this.panel.mesh.position.copy(head).addScaledVector(flat, 0.78);
    this.panel.mesh.position.y = head.y - 0.12;
    this.panel.mesh.lookAt(head.x, head.y - 0.12, head.z);
    this.panel.mesh.visible = true;
    this.cooldown = 0.4;
    this.#layout();
    this.#draw(true);
  }

  hide() {
    this.panel.mesh.visible = false;
    for (const r of this.rays) {
      r.line.visible = false;
      r.cursor.visible = false;
    }
  }

  setData(data) {
    this.data = { ...this.data, ...data };
    this.#layout();
    this.#draw(true);
  }

  update(dt) {
    if (!this.open) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    let hover = null;

    // Raios
    for (const r of this.rays) {
      const visible = r.controller.visible !== false;
      r.line.visible = visible;
      r.cursor.visible = false;
      r.hover = null;
      if (!visible) continue;
      r.controller.updateWorldMatrix(true, false);
      raycaster.ray.origin.setFromMatrixPosition(r.controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(r.controller.matrixWorld);
      const hit = raycaster.intersectObject(this.panel.mesh, false)[0];
      if (hit) {
        r.line.scale.z = hit.distance;
        r.cursor.visible = true;
        r.cursor.position.copy(hit.point).addScaledVector(raycaster.ray.direction, -0.003);
        r.cursor.quaternion.copy(this.panel.mesh.quaternion);
        const id = this.#buttonAt(hit.uv.x * W, (1 - hit.uv.y) * H);
        r.hover = id;
        hover = hover ?? id;
      } else {
        r.line.scale.z = 1.5;
      }
    }

    // Toque com o indicador
    this.rig.sides.forEach((side, i) => {
      if (!side.visible || side.mode !== 'hand') return;
      tmpLocal.copy(side.tips[1]);
      this.panel.mesh.worldToLocal(tmpLocal);
      const px = (tmpLocal.x / 1.1 + 0.5) * W;
      const py = (0.5 - tmpLocal.y / (1.1 * (H / W))) * H;
      const near = Math.abs(tmpLocal.z) < 0.07;
      const id = near ? this.#buttonAt(px, py) : null;
      if (id) hover = id;
      if (tmpLocal.z > 0.02) this.pokeArmed[i] = true;
      if (id && this.pokeArmed[i] && tmpLocal.z < 0.006) {
        this.pokeArmed[i] = false;
        this.#press(id);
      }
    });

    if (hover !== this.hoverId) {
      this.hoverId = hover;
      this.#draw();
    }
    void tmpDir;
  }

  #press(id) {
    if (this.cooldown > 0) return;
    this.cooldown = 0.35;
    const button = this.buttons.find((b) => b.id === id);
    if (!button) return;
    for (const side of this.rig.sides) this.rig.feedback(side.index, 0.25);
    this.bus.emit('ui:click', {});
    this.bus.emit('menu:action', { action: button.action, value: button.value });
  }

  #buttonAt(x, y) {
    const b = this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b?.id ?? null;
  }

  #layout() {
    const d = this.data;
    const btns = [];
    const add = (id, label, x, y, w, h, opts = {}) => btns.push({ id, label, x, y, w, h, ...opts });
    const segmented = (key, options, y, action) => {
      const w = (W - 160) / options.length;
      options.forEach(([value, label], i) => {
        add(`${key}:${value}`, label, 80 + i * w, y, w - 12, 72, { action, value, selected: d[key] === value, kind: 'seg' });
      });
    };

    if (this.page === 'main' || this.page === 'pause') {
      const primary = this.page === 'main' ? ['play', 'JOGAR PARTIDA'] : ['resume', 'RETOMAR'];
      add(primary[0], primary[1], 80, 196, 560, 104, { action: primary[0], primary: true });
      add(this.page === 'main' ? 'training' : 'restart', this.page === 'main' ? 'TREINO LIVRE' : 'REINICIAR', 660, 196, 360, 104, { action: this.page === 'main' ? 'training' : 'restart' });
      segmented('difficulty', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']], 384, 'difficulty');
      segmented('bestOf', [[1, '1 set até 21'], [3, 'Melhor de 3']], 530, 'bestOf');
      add('recenter', 'RECENTRAR', 80, 640, 300, 72, { action: 'recenter' });
      add('replay', d.replay ? 'REPLAY: LIGADO' : 'REPLAY: DESLIGADO', 396, 640, 340, 72, { action: 'replay' });
      if (this.page === 'pause') add('menu', 'SAIR DA PARTIDA', 752, 640, 268, 72, { action: 'training' });
      else add('close', 'FECHAR', 752, 640, 268, 72, { action: 'close' });
    } else if (this.page === 'gameover') {
      add('play', 'JOGAR DE NOVO', 80, 470, 560, 110, { action: 'play', primary: true });
      add('training', 'TREINO LIVRE', 660, 470, 360, 110, { action: 'training' });
      segmented('difficulty', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']], 620, 'difficulty');
    }
    this.buttons = btns;
  }

  #draw(force = false) {
    const sig = `${this.page}|${this.hoverId}|${JSON.stringify(this.data)}|${force ? Math.random() : ''}`;
    this.panel.update(sig, (ctx, p) => {
      p.roundedRect(8, 8, W - 16, H - 16, 48);
      ctx.fillStyle = C.ink;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.edge;
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      if (this.page === 'gameover') {
        const won = this.data.winner === 'A';
        ctx.fillStyle = won ? C.sun : C.muted;
        p.font(800, 28);
        ctx.fillText('FIM DE JOGO', 80, 86);
        ctx.fillStyle = C.text;
        p.font(900, 96);
        ctx.fillText(won ? 'Vitória!' : 'Derrota', 80, 172);
        ctx.fillStyle = C.muted;
        p.font(600, 36);
        const sets = (this.data.history ?? []).map((s) => `${s.A}–${s.B}`).join('   ·   ');
        ctx.fillText(sets || '', 80, 262);
        p.font(500, 30);
        ctx.fillText(won ? 'Você e a Duda venceram a dupla Rafa e Léo.' : 'Rafa e Léo levaram essa. Revanche?', 80, 330);
        ctx.fillText(`Dificuldade: ${this.data.difficultyLabel ?? ''}`, 80, 378);
      } else {
        const grad = ctx.createLinearGradient(80, 0, 380, 0);
        grad.addColorStop(0, C.sun);
        grad.addColorStop(1, C.coral);
        ctx.fillStyle = grad;
        p.roundedRect(80, 62, this.page === 'pause' ? 150 : 230, 40, 20);
        ctx.fill();
        ctx.fillStyle = '#1a0d06';
        p.font(800, 22);
        ctx.fillText(this.page === 'pause' ? 'PAUSADO' : 'BEACH VOLLEY VR', 98, 83);
        ctx.fillStyle = C.text;
        p.font(900, 62);
        ctx.fillText(this.page === 'pause' ? 'Partida pausada' : 'Bora pra areia?', 80, 148);
        ctx.fillStyle = C.muted;
        p.font(700, 24);
        ctx.fillText('DIFICULDADE', 80, 358);
        ctx.fillText('FORMATO', 80, 504);
      }

      for (const b of this.buttons) {
        const hover = b.id === this.hoverId;
        p.roundedRect(b.x, b.y, b.w, b.h, b.kind === 'seg' ? 22 : 28);
        if (b.primary) {
          const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
          g.addColorStop(0, '#ffc073');
          g.addColorStop(1, C.coral);
          ctx.fillStyle = g;
        } else if (b.selected) {
          ctx.fillStyle = 'rgba(255,179,92,0.22)';
        } else {
          ctx.fillStyle = hover ? C.hover : C.faint;
        }
        ctx.fill();
        if (b.selected || hover) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = b.selected ? C.sun : 'rgba(255,255,255,0.35)';
          ctx.stroke();
        }
        if (b.primary && hover) {
          ctx.lineWidth = 5;
          ctx.strokeStyle = '#fff3e0';
          ctx.stroke();
        }
        ctx.fillStyle = b.primary ? '#1a0d06' : C.text;
        p.font(800, b.primary ? 40 : b.kind === 'seg' ? 30 : 28);
        ctx.textAlign = 'center';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
        ctx.textAlign = 'left';
      }
    });
  }
}
