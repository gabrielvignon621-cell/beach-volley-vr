// Motor de áudio do Beach Volley VR.
// Todo o som é sintetizado em código (Web Audio API), sem arquivos externos.

const MAX_VOZES = 16;
const TWO_PI = Math.PI * 2;

// Posições das fontes ambientes
const POS_ONDAS = [
  { x: -14, y: 0, z: -15 },
  { x: -14, y: 0, z: 0 },
  { x: -14, y: 0, z: 15 },
];
const POS_TORCIDA = [
  { x: 11, y: 2, z: 0 },
  { x: 0, y: 2, z: -15 },
  { x: 0, y: 2, z: 15 },
];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const ruido = () => Math.random() * 2 - 1;

// ---------- Geração de buffers ----------

/** Cria um AudioBuffer mono preenchido por fn(t, i) -> amostra. */
function criarBuffer(ctx, dur, fn) {
  const sr = ctx.sampleRate;
  const n = Math.max(1, Math.floor(dur * sr));
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
  return buf;
}

/** Filtro passa-baixa de um polo, com estado próprio. */
function lowpass(coef) {
  let y = 0;
  return (x) => (y += coef * (x - y));
}

/** Filtro passa-alta de um polo. */
function highpass(coef) {
  const lp = lowpass(coef);
  return (x) => x - lp(x);
}

/** Envelope: ataque linear + queda exponencial. */
const env = (t, ataque, queda) => (t < ataque ? t / ataque : Math.exp(-(t - ataque) * queda));

/** Batida: corpo (senoide com queda de frequência) + ruído filtrado. */
function batida(ctx, { dur, f0, f1, tom, ruidoAmt, corte, queda, ataque = 0.002, ganho = 1 }) {
  const lp = lowpass(corte);
  let fase = 0;
  return criarBuffer(ctx, dur, (t) => {
    const f = f1 + (f0 - f1) * Math.exp(-t * 40);
    fase += (TWO_PI * f) / ctx.sampleRate;
    return ganho * env(t, ataque, queda) * (tom * Math.sin(fase) + ruidoAmt * lp(ruido()));
  });
}

/** Aplica fade nas bordas para loops sem estalo. */
function suavizarLoop(d, sr) {
  const f = Math.floor(0.2 * sr);
  for (let i = 0; i < f; i++) {
    const a = i / f;
    d[i] = d[i] * a + d[d.length - f + i] * (1 - a);
  }
}

function gerarBuffers(ctx) {
  const sr = ctx.sampleRate;
  const B = {};

  // Manchete: tum grave e abafado
  B.bump = [0, 1, 2].map((v) =>
    batida(ctx, { dur: 0.28, f0: 160 + v * 12, f1: 70 + v * 6, tom: 0.9, ruidoAmt: 0.5, corte: 0.06, queda: 12 + v * 2 }));
  // Toque: tap curto e suave
  B.set = [0, 1, 2].map((v) =>
    batida(ctx, { dur: 0.12, f0: 420 + v * 40, f1: 220, tom: 0.5, ruidoAmt: 0.5, corte: 0.2, queda: 30, ganho: 0.8 }));
  // Cortada: estalo forte e seco
  B.spike = [0, 1, 2].map((v) => {
    const hp = highpass(0.3);
    const buf = batida(ctx, { dur: 0.25, f0: 260 + v * 20, f1: 110, tom: 0.8, ruidoAmt: 0, corte: 1, queda: 18 });
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (d[i] + 1.1 * Math.exp(-(i / sr) * 90) * hp(ruido())) * 0.9;
    }
    return buf;
  });
  // Saque: batida média
  B.serve = [batida(ctx, { dur: 0.3, f0: 240, f1: 95, tom: 0.9, ruidoAmt: 0.7, corte: 0.15, queda: 14 })];
  // Genérico
  B.hit = [0, 1, 2].map((v) =>
    batida(ctx, { dur: 0.2, f0: 300 + v * 30, f1: 120, tom: 0.7, ruidoAmt: 0.4, corte: 0.12, queda: 20 }));
  // Areia: thump abafado + chiado curto
  B.sand = [0, 1, 2].map((v) => {
    const lpTh = lowpass(0.05);
    const chiado = lowpass(0.35 + v * 0.1);
    let fase = 0;
    return criarBuffer(ctx, 0.45, (t) => {
      fase += (TWO_PI * (90 - t * 80)) / sr;
      const th = Math.sin(fase) * Math.exp(-t * 14) * 0.9;
      const ch = chiado(ruido()) * Math.exp(-t * 9) * 0.5;
      return th + ch + lpTh(ruido()) * Math.exp(-t * 20) * 0.5;
    });
  });
  // Rede: chacoalhar de corda/malha
  {
    const hp = highpass(0.25);
    B.net = [criarBuffer(ctx, 0.7, (t) => {
      const trem = 0.5 + 0.5 * Math.sin(TWO_PI * 24 * t + Math.sin(t * 50));
      return hp(ruido()) * trem * Math.exp(-t * 5) * 0.5
        + Math.sin(TWO_PI * 180 * t) * Math.exp(-t * 12) * 0.2;
    })];
  }
  // Poste: tom metálico curto (parciais inarmônicos)
  B.post = [criarBuffer(ctx, 0.6, (t) => {
    const p = [1, 2.76, 5.4, 8.93];
    let s = 0;
    for (let k = 0; k < p.length; k++) s += Math.sin(TWO_PI * 620 * p[k] * t) * Math.exp(-t * (8 + k * 6)) / (k + 1);
    return s * 0.6 * Math.min(1, t / 0.001);
  })];
  // Apitos: duas senoides moduladas por LFO ~30 Hz (trinado)
  const apito = (dur) => criarBuffer(ctx, dur, (t) => {
    const trino = 0.55 + 0.45 * Math.sin(TWO_PI * 30 * t);
    const vib = 1 + 0.01 * Math.sin(TWO_PI * 6 * t);
    const a = Math.sin(TWO_PI * 2850 * vib * t) + Math.sin(TWO_PI * 3150 * vib * t);
    const e = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.04);
    return a * 0.28 * trino * e + ruido() * 0.03 * e;
  });
  B.whistle = [apito(0.35)];
  B.whistleLong = [apito(0.9)];
  // Mergulho: whoosh + thump
  {
    const lp = lowpass(0.1);
    let fase = 0;
    B.dive = [criarBuffer(ctx, 0.7, (t) => {
      const whoosh = t < 0.35 ? lp(ruido()) * Math.sin(Math.PI * t / 0.35) * 0.8 : 0;
      const tt = t - 0.3;
      fase += (TWO_PI * 70) / sr;
      const thump = tt > 0 ? Math.sin(fase) * Math.exp(-tt * 12) * 0.9 + ruido() * Math.exp(-tt * 20) * 0.2 : 0;
      return whoosh + thump;
    })];
  }
  // Passo na areia, bem baixo
  B.step = [0, 1].map((v) => {
    const lp = lowpass(0.15 + v * 0.05);
    return criarBuffer(ctx, 0.15, (t) => lp(ruido()) * Math.exp(-t * 28) * 0.5);
  });
  // Clique de UI
  B.click = [criarBuffer(ctx, 0.05, (t) => Math.sin(TWO_PI * 1400 * t) * Math.exp(-t * 90) * 0.5)];
  // Jingles: notas sequenciais com harmônico
  const jingle = (notas, passo, nota) => {
    const dur = passo * (notas.length - 1) + nota;
    return criarBuffer(ctx, dur, (t) => {
      let s = 0;
      for (let k = 0; k < notas.length; k++) {
        const tt = t - k * passo;
        if (tt < 0) continue;
        const e = Math.min(1, tt / 0.005) * Math.exp(-tt * 5);
        s += (Math.sin(TWO_PI * notas[k] * tt) + 0.3 * Math.sin(TWO_PI * notas[k] * 2 * tt)) * e;
      }
      return s * 0.3;
    });
  };
  B.point = [jingle([523.25, 659.25, 783.99], 0.11, 0.5)];
  B.gameover = [jingle([392, 523.25, 659.25, 523.25, 659.25, 783.99, 1046.5], 0.17, 1.0)];

  // Piado de gaivota (chirp FM descendente), 2 variações
  B.gull = [0, 1].map((v) => criarBuffer(ctx, 0.9, (t) => {
    let s = 0;
    for (let k = 0; k < 2 + v; k++) {
      const tt = t - k * 0.28;
      if (tt < 0 || tt > 0.25) continue;
      const f = 2200 - tt * 2400 + 300 * Math.sin(TWO_PI * 30 * tt);
      s += Math.sin(TWO_PI * f * tt + 3 * Math.sin(TWO_PI * 700 * tt)) * Math.sin(Math.PI * tt / 0.25);
    }
    return s * 0.25;
  }));

  // Onda de torcida: ruído em banda de voz + aplausos
  {
    const dur = 2.8;
    const lp = lowpass(0.25), hp = highpass(0.03), lp2 = lowpass(0.5), hp2 = highpass(0.4);
    const claps = new Float32Array(Math.floor(dur * sr));
    for (let i = 0; i < 70; i++) {
      const ini = Math.floor(rand(0.3, 2.6) * sr);
      const amp = rand(0.2, 0.5);
      for (let j = 0; j < 0.02 * sr && ini + j < claps.length; j++) {
        claps[ini + j] += ruido() * Math.exp(-(j / sr) * 200) * amp;
      }
    }
    B.cheer = [criarBuffer(ctx, dur, (t, i) => {
      const e = Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 1.0) * (0.7 + 0.3 * Math.sin(TWO_PI * 5 * t));
      const voz = hp(lp(ruido())) * 2.2;
      const form = Math.sin(TWO_PI * (330 + 120 * Math.sin(t * 2)) * t) * 0.12;
      return (voz + form) * e * 0.9 + hp2(lp2(claps[i])) * 0.6;
    })];
  }

  return B;
}

// Buffers longos em loop para os ambientes
function gerarLoops(ctx) {
  const sr = ctx.sampleRate;
  // Ruído marrom (ondas e vento)
  const marrom = (dur) => {
    const buf = ctx.createBuffer(1, Math.floor(dur * sr), sr);
    const d = buf.getChannelData(0);
    let u = 0;
    for (let i = 0; i < d.length; i++) { u = (u + 0.02 * ruido()) / 1.02; d[i] = u * 3.5; }
    suavizarLoop(d, sr);
    return buf;
  };
  // Murmúrio da torcida: ruído de banda média com modulação lenta
  const murmurio = (dur) => {
    const buf = ctx.createBuffer(1, Math.floor(dur * sr), sr);
    const d = buf.getChannelData(0);
    const lp = lowpass(0.2), hp = highpass(0.02);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = hp(lp(ruido())) * 2.5 * (0.75 + 0.25 * Math.sin(TWO_PI * 0.5 * t));
    }
    suavizarLoop(d, sr);
    return buf;
  };
  return { ondas: marrom(6), torcida: murmurio(4), vento: marrom(4) };
}

// ---------- Motor ----------

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.desbloqueado = false;
    this.volumeMestre = 1;
    this.excitacao = 0.3;
    this._excitacaoAlvo = 0.3;
    this._buffers = null;
    this._vozes = [];
    this._contador = 0;
    this._ondas = [];
    this._tempoGaivota = 8;
    this._Ctx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  }

  /** Cria/retoma o contexto; deve ser chamado num gesto do usuário. */
  unlock() {
    if (!this._Ctx) return;
    try {
      if (!this.ctx) {
        this.ctx = new this._Ctx();
        this._montar();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this.desbloqueado = true;
    } catch (e) {
      this.ctx = null;
      this.desbloqueado = false;
    }
  }

  _montar() {
    const ctx = this.ctx;
    // Cadeia mestre: master -> compressor (limitador suave) -> saída
    this.master = ctx.createGain();
    this.master.gain.value = this.volumeMestre;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this._buffers = gerarBuffers(ctx);
    // Pool de vozes: gain + panner reutilizados
    for (let i = 0; i < MAX_VOZES; i++) {
      this._vozes.push({
        gain: ctx.createGain(),
        panner: this._criarPanner(2),
        fonte: null,
        ordem: 0,
        ativa: false,
      });
    }
    this._iniciarAmbientes();
  }

  _criarPanner(ref) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 10000;
    return p;
  }

  _posicionar(panner, pos) {
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
  }

  _iniciarAmbientes() {
    const ctx = this.ctx;
    const loops = gerarLoops(ctx);
    const loop = (buf, offset) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, offset % buf.duration);
      return s;
    };

    // Ondas: 3 fontes, lowpass ~600 Hz, envelope lento de quebra
    POS_ONDAS.forEach((pos, i) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const pan = this._criarPanner(8);
      this._posicionar(pan, pos);
      loop(loops.ondas, i * 1.7).connect(lp).connect(g).connect(pan).connect(this.master);
      this._ondas.push({ gain: g, prox: rand(0.5, 3) + i });
    });

    // Torcida: 3 arquibancadas, ganho controlado pela excitação
    this.torcidaGain = ctx.createGain();
    this.torcidaGain.gain.value = 0;
    this.torcidaGain.connect(this.master);
    POS_TORCIDA.forEach((pos, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700 + i * 120;
      bp.Q.value = 0.6;
      const pan = this._criarPanner(6);
      this._posicionar(pan, pos);
      loop(loops.torcida, i * 1.3).connect(bp).connect(pan).connect(this.torcidaGain);
    });

    // Vento leve, não espacial
    const vf = ctx.createBiquadFilter();
    vf.type = 'bandpass';
    vf.frequency.value = 400;
    vf.Q.value = 0.5;
    const vg = ctx.createGain();
    vg.gain.value = 0.025;
    loop(loops.vento, 0).connect(vf).connect(vg).connect(this.master);
  }

  /** Toca um one-shot. position: {x,y,z} ou null. */
  play(name, position, opts = {}) {
    if (!this.desbloqueado || !this.ctx) return;
    try {
      const lista = this._buffers[name];
      if (!lista) return;
      this._tocar(pick(lista), position, opts.volume ?? 1, opts.rate ?? 1, opts.ref ?? 2);
    } catch (e) { /* silencioso */ }
  }

  _tocar(buffer, pos, volume, rate, ref) {
    // Escolhe voz livre; senão rouba a mais antiga
    let voz = this._vozes.find((v) => !v.ativa);
    if (!voz) voz = this._vozes.reduce((a, b) => (a.ordem <= b.ordem ? a : b));
    if (voz.fonte) {
      voz.fonte.onended = null;
      try { voz.fonte.stop(); } catch (e) { /* já parada */ }
      voz.fonte.disconnect();
    }
    voz.gain.disconnect();
    voz.panner.disconnect();
    voz.gain.gain.value = volume;

    if (pos) {
      voz.panner.refDistance = ref;
      this._posicionar(voz.panner, pos);
      voz.gain.connect(voz.panner);
      voz.panner.connect(this.master);
    } else {
      voz.gain.connect(this.master);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(voz.gain);
    voz.fonte = src;
    voz.ativa = true;
    voz.ordem = ++this._contador;
    src.onended = () => {
      voz.ativa = false;
      voz.fonte = null;
      src.disconnect();
    };
    src.start();
  }

  /** Excitação da torcida (0..1), suavizada no update. */
  setCrowdExcitement(v) {
    this._excitacaoAlvo = Math.min(1, Math.max(0, +v || 0));
  }

  /** Onda de torcida vinda das três arquibancadas (~2,8 s). */
  cheer(intensity = 1) {
    if (!this.desbloqueado || !this.ctx) return;
    try {
      const buf = this._buffers.cheer[0];
      const vol = 0.5 * Math.min(1.5, Math.max(0, intensity));
      for (const pos of POS_TORCIDA) this._tocar(buf, pos, vol, rand(0.95, 1.05), 8);
    } catch (e) { /* silencioso */ }
  }

  setMasterVolume(v) {
    this.volumeMestre = Math.min(1, Math.max(0, +v || 0));
    if (this.master) this.master.gain.setTargetAtTime(this.volumeMestre, this.ctx.currentTime, 0.02);
  }

  /** Atualiza ambientes e o AudioListener. listener: THREE.Object3D. */
  update(dt, listener) {
    if (!this.desbloqueado || !this.ctx) return;
    const ctx = this.ctx;
    const agora = ctx.currentTime;

    // Torcida: suaviza excitação -> volume
    this.excitacao += (this._excitacaoAlvo - this.excitacao) * Math.min(1, dt * 2);
    this.torcidaGain.gain.setTargetAtTime(0.03 + 0.17 * this.excitacao, agora, 0.1);

    // Ondas: nova "quebra" quando o temporizador vence
    for (const o of this._ondas) {
      o.prox -= dt;
      if (o.prox <= 0) {
        o.gain.gain.cancelScheduledValues(agora);
        o.gain.gain.setTargetAtTime(rand(0.12, 0.2), agora, 1.2);
        o.gain.gain.setTargetAtTime(0.04, agora + 2.5, 1.5);
        o.prox = rand(5, 8);
      }
    }

    // Gaivotas ocasionais sobre o mar
    this._tempoGaivota -= dt;
    if (this._tempoGaivota <= 0) {
      this._tempoGaivota = rand(6, 15);
      this.play('gull', { x: -rand(20, 60), y: rand(10, 25), z: rand(-25, 25) },
        { volume: rand(0.25, 0.45), rate: rand(0.85, 1.2), ref: 12 });
    }

    // Listener a partir da matrixWorld (forward = -Z, up = +Y)
    if (listener && listener.matrixWorld) {
      const e = listener.matrixWorld.elements;
      const fx = -e[8], fy = -e[9], fz = -e[10];
      const ux = e[4], uy = e[5], uz = e[6];
      const nf = Math.hypot(fx, fy, fz) || 1;
      const nu = Math.hypot(ux, uy, uz) || 1;
      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = e[12]; L.positionY.value = e[13]; L.positionZ.value = e[14];
        L.forwardX.value = fx / nf; L.forwardY.value = fy / nf; L.forwardZ.value = fz / nf;
        L.upX.value = ux / nu; L.upY.value = uy / nu; L.upZ.value = uz / nu;
      } else {
        L.setPosition(e[12], e[13], e[14]);
        L.setOrientation(fx / nf, fy / nf, fz / nf, ux / nu, uy / nu, uz / nu);
      }
    }
  }
}
