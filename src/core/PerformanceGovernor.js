/**
 * Mede a taxa de quadros real e ajusta a qualidade para manter o alvo:
 * - no Quest, sobe o foveated rendering quando os quadros atrasam e baixa quando sobra folga;
 *   se nem com foveation máxima 90 Hz se sustenta, cai para 72 Hz;
 * - no navegador, ajusta o pixel ratio.
 */
export class PerformanceGovernor {
  constructor(renderer, xrManager) {
    this.renderer = renderer;
    this.xr = xrManager;
    this.fps = 0;
    this.frameMs = 0;
    this.foveation = 0.5;
    this.frames = 0;
    this.elapsed = 0;
    this.strikes = 0;
    this.desktopRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.maxDesktopRatio = this.desktopRatio;
    renderer.xr.setFoveation(this.foveation);
  }

  update(dt) {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 1) return;
    this.fps = this.frames / this.elapsed;
    this.frameMs = (this.elapsed / this.frames) * 1000;
    this.frames = 0;
    this.elapsed = 0;

    if (this.renderer.xr.isPresenting) this.#tuneXR();
    else this.#tuneDesktop();
  }

  #tuneXR() {
    const target = this.xr.frameRate || 72;
    if (this.fps < target * 0.9) {
      if (this.foveation < 1) {
        this.foveation = Math.min(1, this.foveation + 0.15);
        this.renderer.xr.setFoveation(this.foveation);
      } else if (++this.strikes >= 3) {
        this.strikes = 0;
        this.xr.lowerFrameRate();
      }
    } else if (this.fps > target * 0.98 && this.foveation > 0.35) {
      this.strikes = 0;
      this.foveation = Math.max(0.35, this.foveation - 0.05);
      this.renderer.xr.setFoveation(this.foveation);
    }
  }

  #tuneDesktop() {
    let next = this.desktopRatio;
    if (this.fps < 50) next = Math.max(0.75, this.desktopRatio - 0.25);
    else if (this.fps > 58) next = Math.min(this.maxDesktopRatio, this.desktopRatio + 0.125);
    if (next !== this.desktopRatio) {
      this.desktopRatio = next;
      this.renderer.setPixelRatio(next);
    }
  }
}
