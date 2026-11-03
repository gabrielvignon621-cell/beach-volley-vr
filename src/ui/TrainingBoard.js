import { CanvasPanel } from './CanvasPanel.js';
import { COURT, PLAYER } from '../config.js';

const COLORS = {
  glass: 'rgba(9, 14, 26, 0.84)',
  edge: 'rgba(255, 255, 255, 0.14)',
  text: '#f8fafc',
  muted: '#9fb0c8',
  sun: '#ffb35c',
  coral: '#ff6b4a',
  sea: '#2dd4bf',
};

/**
 * Placa de treino dentro da cena (VR): instruções + telemetria (FPS, Hz, foveation, bola).
 * Fica na lateral esquerda, voltada para o jogador, fora da linha de visão da rede.
 */
export class TrainingBoard {
  constructor(scene) {
    this.panel = new CanvasPanel({ width: 1024, height: 600, worldWidth: 1.05 });
    const { mesh } = this.panel;
    mesh.position.set(-COURT.halfWidth - 0.7, 1.45, PLAYER.spawn.z - 1.2);
    mesh.lookAt(PLAYER.spawn.x, 1.5, PLAYER.spawn.z);
    scene.add(mesh);
  }

  update(state) {
    const sig = [
      Math.round(state.fps),
      state.frameRate,
      Math.round(state.foveation * 100),
      state.ballSpeed.toFixed(1),
      state.handTracking,
      state.lastSurface,
      state.serves,
    ].join('|');

    this.panel.update(sig, (ctx, p) => {
      const W = 1024;
      const H = 600;
      p.roundedRect(8, 8, W - 16, H - 16, 44);
      ctx.fillStyle = COLORS.glass;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.edge;
      ctx.stroke();

      const grad = ctx.createLinearGradient(56, 0, 420, 0);
      grad.addColorStop(0, COLORS.sun);
      grad.addColorStop(1, COLORS.coral);
      ctx.fillStyle = grad;
      p.roundedRect(56, 56, 210, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#1a0d06';
      p.font(800, 24);
      ctx.textBaseline = 'middle';
      ctx.fillText('FASE 1 · TREINO', 76, 79);

      ctx.fillStyle = COLORS.text;
      p.font(800, 58);
      ctx.fillText('Máquina de saque', 56, 160);
      ctx.fillStyle = COLORS.muted;
      p.font(500, 32);
      ctx.fillText(state.handTracking ? 'Faça uma pinça para a máquina sacar.' : 'Aperte o gatilho para a máquina sacar.', 56, 222);
      ctx.fillText('Veja a bola cruzar a rede e cair na areia.', 56, 266);

      ctx.fillStyle = COLORS.edge;
      ctx.fillRect(56, 318, W - 112, 2);

      const stats = [
        ['FPS', `${Math.round(state.fps)}`, state.fps >= (state.frameRate || 72) * 0.95 ? COLORS.sea : COLORS.sun],
        ['ALVO', state.frameRate ? `${state.frameRate} Hz` : '—', COLORS.text],
        ['FOVEATION', `${Math.round(state.foveation * 100)}%`, COLORS.text],
        ['BOLA', `${state.ballSpeed.toFixed(1)} m/s`, COLORS.text],
      ];
      stats.forEach(([label, value, color], i) => {
        const x = 56 + i * 232;
        ctx.fillStyle = COLORS.muted;
        p.font(700, 22);
        ctx.fillText(label, x, 372);
        ctx.fillStyle = color;
        p.font(800, 46);
        ctx.fillText(value, x, 424);
      });

      ctx.fillStyle = COLORS.muted;
      p.font(500, 28);
      const surface = { sand: 'areia', net: 'rede', post: 'poste', antenna: 'antena' }[state.lastSurface] ?? '—';
      ctx.fillText(`Saques: ${state.serves}   ·   Último contato: ${surface}`, 56, 500);
      ctx.fillText(state.handTracking ? 'Entrada: mãos rastreadas' : 'Entrada: controles Touch', 56, 544);
    });
  }
}
