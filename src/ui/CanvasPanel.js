import * as THREE from 'three';

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

/**
 * Painel 3D desenhado em canvas (texto nítido em VR, sem fontes 3D pesadas).
 * Redesenha só quando o conteúdo muda.
 */
export class CanvasPanel {
  constructor({ width = 1024, height = 512, worldWidth = 0.9 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    const worldHeight = worldWidth * (height / width);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldWidth, worldHeight),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 10;
    this.signature = '';
  }

  roundedRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  font(weight, size) {
    this.ctx.font = `${weight} ${size}px ${FONT}`;
  }

  /** `draw(ctx, panel)` só roda se `signature` mudou desde a última vez. */
  update(signature, draw) {
    if (signature === this.signature) return;
    this.signature = signature;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    draw(this.ctx, this);
    this.texture.needsUpdate = true;
  }
}
