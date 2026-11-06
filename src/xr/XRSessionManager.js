const PREFERRED_RATES = [90, 72];

/**
 * Cuida do ciclo de vida da sessão imersiva:
 * - pede hand-tracking como recurso obrigatório e, se o navegador recusar,
 *   reabre só com controles Touch (fallback exigido pelo projeto);
 * - sobe a taxa de quadros para 90 Hz quando o headset oferece.
 */
export class XRSessionManager {
  constructor(renderer, bus) {
    this.renderer = renderer;
    this.bus = bus;
    this.session = null;
    this.handTracking = false;
    this.frameRate = null;
  }

  async checkSupport() {
    if (!('xr' in navigator)) return window.isSecureContext ? 'no-webxr' : 'insecure';
    try {
      return (await navigator.xr.isSessionSupported('immersive-vr')) ? 'supported' : 'unsupported';
    } catch {
      return 'unsupported';
    }
  }

  get active() {
    return this.session !== null;
  }

  async enter() {
    if (this.session) return;
    // Um único pedido (o navegador só aceita requestSession logo após o clique):
    // hand-tracking opcional, para nunca falhar se o rastreio de mãos estiver desligado.
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'bounded-floor'],
    });
    const features = session.enabledFeatures;
    this.handTracking = features ? Array.from(features).includes('hand-tracking') : true;

    session.addEventListener('end', () => this.#onEnd(), { once: true });
    this.session = session;

    const { xr } = this.renderer;
    xr.setReferenceSpaceType('local-floor');
    await xr.setSession(session);
    await this.#raiseFrameRate(session);

    this.bus.emit('xr:start', { handTracking: this.handTracking, frameRate: this.frameRate });
  }

  async exit() {
    await this.session?.end();
  }

  async #raiseFrameRate(session) {
    const rates = session.supportedFrameRates;
    if (!rates || typeof session.updateTargetFrameRate !== 'function') {
      this.frameRate = session.frameRate ?? null;
      return;
    }
    const target = PREFERRED_RATES.find((r) => Array.from(rates).includes(r));
    if (!target) return;
    try {
      await session.updateTargetFrameRate(target);
      this.frameRate = target;
    } catch {
      this.frameRate = session.frameRate ?? null;
    }
  }

  /** Usado pelo governador de desempenho quando 90 Hz não se sustenta. */
  async lowerFrameRate() {
    if (!this.session || this.frameRate !== 90) return false;
    try {
      await this.session.updateTargetFrameRate(72);
      this.frameRate = 72;
      this.bus.emit('xr:framerate', { frameRate: 72 });
      return true;
    } catch {
      return false;
    }
  }

  #onEnd() {
    this.session = null;
    this.bus.emit('xr:end', {});
  }
}
