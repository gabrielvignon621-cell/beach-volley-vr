const SURFACE_LABEL = { sand: 'na areia', net: 'na rede', post: 'no poste', antenna: 'na antena' };
const HIT_LABEL = { bump: 'Manchete', dig: 'Defesa', set: 'Toque', spike: 'Cortada', serve: 'Saque', block: 'Bloqueio', hit: 'Toque' };

const SUPPORT_MESSAGES = {
  supported: ['ready', 'Headset pronto. A sessão pede hand tracking e cai para os controles se ele estiver desligado.'],
  unsupported: ['warn', 'Nenhum headset VR neste navegador. Treine ou assista a uma partida no PC.'],
  'no-webxr': ['warn', 'Este navegador não oferece WebXR. No Quest, use o Meta Quest Browser.'],
  insecure: ['warn', 'WebXR exige HTTPS. Abra o endereço https:// mostrado pelo servidor.'],
};

/** Liga o DOM (menu, HUD do navegador, nota de VR) ao jogo. */
export class Menu {
  constructor() {
    this.body = document.body;
    this.loader = document.querySelector('.loader');
    this.status = document.querySelector('#status');
    this.statusText = this.status.querySelector('.status-text');
    this.vrButton = document.querySelector('#btn-vr');
    this.exploreButton = document.querySelector('#btn-explore');
    this.watchButton = document.querySelector('#btn-watch');
    this.fps = document.querySelector('#fps');
    this.toast = document.querySelector('#toast');
    this.scorebar = document.querySelector('#scorebar');
    this.toastTimer = 0;
    this.lastScore = { A: 0, B: 0 };
  }

  setStatus(state, text) {
    this.status.dataset.state = state;
    this.statusText.textContent = text;
  }

  progress(value, label) {
    this.loader.style.setProperty('--progress', `${Math.round(value * 100)}%`);
    if (value < 1) this.setStatus('loading', label);
  }

  setMode(mode) {
    this.body.dataset.mode = mode;
  }

  async connect(game) {
    const { bus } = game;
    this.body.dataset.ready = 'true';
    game.view.setFollowSource(() => game.ball.mesh.position);

    // O áudio só pode começar depois de um gesto do usuário.
    const unlock = () => game.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    const support = await game.xr.checkSupport();
    const [state, message] = SUPPORT_MESSAGES[support];
    this.setStatus(state, message);
    this.vrButton.disabled = support !== 'supported';
    this.exploreButton.disabled = false;
    this.watchButton.disabled = false;

    this.vrButton.addEventListener('click', async () => {
      game.audio.unlock();
      this.vrButton.disabled = true;
      this.setStatus('loading', 'Abrindo a sessão imersiva…');
      try {
        await game.xr.enter();
      } catch (error) {
        this.vrButton.disabled = false;
        this.setStatus('error', `Não foi possível entrar em VR: ${error.message}`);
      }
    });

    this.exploreButton.addEventListener('click', () => {
      game.startTraining();
      this.setMode('explore');
      game.view.setMode('explore');
      this.#selectCamera('player');
      this.#toast('Arraste para girar, role para aproximar. <b>Espaço</b> faz a máquina sacar.');
    });

    this.watchButton.addEventListener('click', () => {
      game.startMatch({ demo: true });
      this.setMode('explore');
      game.view.setMode('explore');
      this.#selectCamera('follow');
      game.view.goTo('follow');
      this.#toast(`Partida de demonstração · <b>${game.difficulty.label}</b>. Teclas <b>1–4</b> trocam a câmera.`);
    });

    document.querySelector('#btn-back').addEventListener('click', () => {
      this.setMode('menu');
      game.view.setMode('menu');
    });

    for (const button of document.querySelectorAll('[data-cam]')) {
      button.addEventListener('click', () => {
        this.#selectCamera(button.dataset.cam);
        game.view.goTo(button.dataset.cam);
      });
    }

    for (const button of document.querySelectorAll('[data-diff]')) {
      button.addEventListener('click', () => game.setDifficulty(button.dataset.diff));
    }
    for (const button of document.querySelectorAll('[data-bestof]')) {
      button.addEventListener('click', () => game.setBestOf(Number(button.dataset.bestof)));
    }
    bus.on('game:settings', ({ difficulty, bestOf }) => {
      for (const b of document.querySelectorAll('[data-diff]')) b.setAttribute('aria-checked', String(b.dataset.diff === difficulty));
      for (const b of document.querySelectorAll('[data-bestof]')) b.setAttribute('aria-checked', String(Number(b.dataset.bestof) === bestOf));
    });

    const actions = {
      machine: () => game.machineServe(),
      serve: () => game.playerServe(),
      reset: () => game.parkBall(),
      restart: () => game.startMatch({ demo: true }),
      training: () => {
        game.startTraining();
        this.#selectCamera('player');
        game.view.goTo('player');
      },
    };
    for (const button of document.querySelectorAll('[data-action]')) {
      button.addEventListener('click', () => actions[button.dataset.action]());
    }

    window.addEventListener('keydown', (event) => {
      if (this.body.dataset.mode !== 'explore' || event.repeat) return;
      const demo = this.body.dataset.game === 'demo';
      const keys = demo ? { KeyN: 'restart', KeyT: 'training' } : { Space: 'machine', KeyS: 'serve', KeyR: 'reset' };
      const key = keys[event.code];
      if (key) {
        event.preventDefault();
        actions[key]();
      }
      const cams = { Digit1: 'player', Digit2: 'tv', Digit3: 'net', Digit4: 'follow' };
      if (cams[event.code]) {
        this.#selectCamera(cams[event.code]);
        game.view.goTo(cams[event.code]);
      }
      if (event.code === 'Escape') document.querySelector('#btn-back').click();
    });

    bus.on('stats', ({ fps }) => { this.fps.textContent = Math.round(fps); });

    bus.on('game:mode', ({ mode }) => {
      this.body.dataset.game = mode === 'training' ? 'training' : mode;
    });

    bus.on('score', (s) => this.#renderScore(s));

    bus.on('ball:contact', ({ surface, speed }) => {
      if (this.body.dataset.mode !== 'explore' || this.body.dataset.game !== 'training' || speed < 1.5) return;
      this.#toast(`Bola ${SURFACE_LABEL[surface] ?? 'tocou algo'} a <b>${(speed * 3.6).toFixed(0)} km/h</b>`);
    });

    bus.on('match:point', (p) => {
      if (this.body.dataset.mode !== 'explore') return;
      const who = p.lastActor?.name ?? '';
      const how = p.reason === 'in' && p.lastActor && p.lastActor.team === p.winner ? `${HIT_LABEL[p.lastKind] ?? 'Ponto'} de ${who}` : p.reasonText;
      const team = p.winner === 'A' ? 'Duda + Você' : 'Rafa + Léo';
      this.#toast(`<b>Ponto ${team}</b> · ${how} · ${p.rallyTouches} toques no rally`);
    });

    bus.on('match:over', ({ winner, history }) => {
      if (this.body.dataset.mode !== 'explore') return;
      const sets = history.map((s) => `${s.A}–${s.B}`).join(' · ');
      this.#toast(`<b>Fim de jogo</b> · ${winner === 'A' ? 'Duda + Você' : 'Rafa + Léo'} venceram (${sets})`, 5000);
    });

    bus.on('xr:start', ({ handTracking }) => {
      this.setMode('vr');
      this.setStatus('ready', handTracking ? 'Em VR com mãos rastreadas.' : 'Em VR com controles Touch.');
    });

    bus.on('xr:end', () => {
      this.setMode('menu');
      game.view.setMode('menu');
      this.vrButton.disabled = false;
      this.setStatus('ready', 'Sessão encerrada. Você pode entrar de novo quando quiser.');
    });
  }

  #renderScore(s) {
    const bar = this.scorebar;
    bar.dataset.serving = s.serving ?? '';
    bar.querySelector('.sb-label').textContent = s.label.split(' · ')[0];
    bar.querySelector('.sb-sets').textContent = s.bestOf > 1 ? `${s.sets.A} · ${s.sets.B}` : s.label.split(' · ')[1] ?? '';
    bar.querySelector('.sb-a .sb-name').textContent = s.mode === 'demo' ? 'Duda + Bia' : 'Duda + Você';
    for (const team of ['A', 'B']) {
      const el = bar.querySelector(`.sb-score[data-team="${team}"]`);
      el.textContent = s.score[team];
      if (s.score[team] > this.lastScore[team]) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 320);
      }
    }
    this.lastScore = { ...s.score };
  }

  #selectCamera(name) {
    for (const b of document.querySelectorAll('[data-cam]')) {
      b.setAttribute('aria-checked', String(b.dataset.cam === name));
    }
  }

  #toast(html, duration = 2600) {
    this.toast.innerHTML = html;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('show'), duration);
  }
}
