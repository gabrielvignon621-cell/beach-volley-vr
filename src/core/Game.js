import * as THREE from 'three';
import { BALL, COURT, DIFFICULTY, NET, PLAYER, TEAMS } from '../config.js';
import { EventBus } from './EventBus.js';
import { PerformanceGovernor } from './PerformanceGovernor.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Ball } from '../physics/Ball.js';
import { heightAtNet, solveLaunch } from '../physics/trajectory.js';
import { createEnvironment } from '../world/Environment.js';
import { createOcean } from '../world/Ocean.js';
import { createSand } from '../world/Sand.js';
import { createCourt } from '../world/Court.js';
import { createScenery } from '../world/Scenery.js';
import { Crowd } from '../world/Crowd.js';
import { SandBurst } from '../effects/SandBurst.js';
import { BallFx } from '../effects/BallFx.js';
import { BallMachine } from '../gameplay/BallMachine.js';
import { HitSystem } from '../gameplay/HitSystem.js';
import { PlayerStriker } from '../gameplay/PlayerStriker.js';
import { Match } from '../gameplay/Match.js';
import { Replay } from '../gameplay/Replay.js';
import { BotDirector } from '../bots/BotDirector.js';
import { XRSessionManager } from '../xr/XRSessionManager.js';
import { HandRig } from '../xr/HandRig.js';
import { Locomotion } from '../xr/Locomotion.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { TrainingBoard } from '../ui/TrainingBoard.js';
import { Scoreboard, Banner, WristWatch, createNameTag } from '../ui/VRHud.js';
import { VRMenu } from '../ui/VRMenu.js';
import { DesktopView } from '../desktop/DesktopView.js';

const tmp = new THREE.Vector3();
const HIT_SOUND = { bump: 'bump', dig: 'bump', set: 'set', spike: 'spike', serve: 'serve', block: 'hit', hit: 'hit' };
const HIT_LABEL = { bump: 'Manchete', dig: 'Defesa', set: 'Toque', spike: 'Cortada', serve: 'Saque', block: 'Bloqueio', hit: 'Toque' };

/**
 * Monta a cena e roda o loop. Os sistemas conversam pelo EventBus:
 * física → golpes (HitSystem) → regras (Match) → bots (BotDirector) → áudio/HUD/efeitos.
 *
 * Modos:
 * - training: máquina de saque, bots aquecendo, painel de métricas;
 * - match: partida 2x2 (você + Duda contra Rafa + Léo), em VR;
 * - demo: partida 4 bots, para assistir no navegador.
 */
export class Game {
  constructor(container, onProgress = () => {}) {
    this.bus = new EventBus();
    this.container = container;
    this.onProgress = onProgress;
    this.serves = 0;
    this.lastSurface = null;
    this.mode = 'training';
    this.settings = { difficulty: 'normal', bestOf: 1, replay: true };
    this.serveTossed = false;
    this.netFaultCooldown = 0;
    this.time = 0;
  }

  async build() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.xr.enabled = true;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 3000);

    const step = async (progress, label, fn) => {
      this.onProgress(progress, label);
      await new Promise((r) => requestAnimationFrame(r));
      return fn();
    };

    const env = await step(0.2, 'Pintando o céu…', () => createEnvironment(renderer, this.scene));
    this.env = env;
    this.ocean = await step(0.32, 'Enchendo o mar…', () => createOcean(this.scene, env.skyCube));
    await step(0.44, 'Espalhando a areia…', () => createSand(this.scene));
    this.court = await step(0.54, 'Armando a rede…', () => createCourt(this.scene));
    this.scenery = await step(0.64, 'Plantando palmeiras…', () => createScenery(this.scene));
    this.crowd = await step(0.72, 'Chamando a torcida…', () => new Crowd(this.scene));

    await step(0.8, 'Ligando a física…', () => {
      this.physics = new PhysicsWorld();
      this.ball = new Ball(this.physics, this.scene, this.bus);
      this.machine = new BallMachine(this.scene, this.ball);
      this.sand = new SandBurst(this.scene);
      this.fx = new BallFx(this.scene);
      this.hits = new HitSystem(this.physics, this.ball, this.bus);
      this.match = new Match(this.bus);
    });

    await step(0.88, 'Aquecendo os atletas…', () => {
      this.human = {
        id: 'you',
        name: 'Você',
        team: 'A',
        sign: 1,
        isHuman: true,
        position: new THREE.Vector3(PLAYER.spawn.x, 0, PLAYER.spawn.z),
        head: new THREE.Vector3(PLAYER.spawn.x, PLAYER.eyeHeight, PLAYER.spawn.z),
      };
      this.director = new BotDirector({
        scene: this.scene,
        bus: this.bus,
        ball: this.ball,
        hitSystem: this.hits,
        match: this.match,
        human: this.human,
        physics: this.physics,
        getDifficulty: () => this.difficulty,
      });
      this.tags = this.director.bots.map((bot) => {
        const tag = createNameTag(bot.name, TEAMS[bot.team].accent);
        tag.renderOrder = 12;
        this.scene.add(tag);
        return { bot, tag };
      });
      this.director.idleAround();
      for (const bot of this.director.bots) bot.position.copy(bot.target);
    });

    this.xr = new XRSessionManager(renderer, this.bus);
    this.rig = new HandRig(renderer, this.scene, this.bus);
    this.striker = this.hits.add(new PlayerStriker(this.rig, this.human, this.#strikerContext()));
    this.hits.gate = (actor) => this.match.mode !== 'match' || this.match.canTouch(actor);
    this.locomotion = new Locomotion(renderer, this.scene, this.rig);
    this.audio = new AudioEngine();
    this.board = new TrainingBoard(this.scene);
    this.scoreboard = new Scoreboard(this.scene);
    this.banner = new Banner(this.scene);
    this.watch = new WristWatch(this.scene);
    this.vrMenu = new VRMenu(this.scene, this.rig, this.bus);
    this.replay = new Replay(this.ball, () => this.director.activeBots().map((b) => b.athlete));
    this.governor = new PerformanceGovernor(renderer, this.xr);
    this.view = new DesktopView(this.camera, renderer.domElement);

    this.#wireEvents();
    this.parkBall();

    // Compila todos os shaders antes do primeiro quadro para evitar engasgos.
    renderer.compile(this.scene, this.camera);
    window.addEventListener('resize', () => this.#resize());
    this.onProgress(1, 'Pronto');
  }

  get difficulty() {
    return { ...DIFFICULTY[this.settings.difficulty], key: this.settings.difficulty };
  }

  get paused() {
    return this.vrMenu.open && this.match.playing && this.mode === 'match';
  }

  start() {
    let last = performance.now();
    let boardTimer = 0;
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.time += dt;
      const time = now / 1000;
      const presenting = this.renderer.xr.isPresenting;
      const viewer = presenting ? this.renderer.xr.getCamera() : this.camera;

      this.#updateHuman(viewer, presenting);
      this.rig.update(dt, viewer);
      this.striker.frameDt = dt || 1 / 72;
      this.locomotion.handsEnabled = !this.vrMenu.open;
      this.locomotion.update(dt);

      const paused = this.paused;
      if (!paused) {
        this.#updateHumanServe();
        this.physics.step(dt);
        this.match.update(dt, this.ball.position);
        this.director.update(dt);
        this.#checkHumanNetTouch(dt);
      }
      this.ball.render(this.physics.alpha, dt);

      if (this.replay.playing) {
        if (!this.replay.update(dt)) this.fx.clearTrail();
      } else if (!paused) {
        this.replay.record(dt);
      }

      this.court.update(dt);
      this.machine.update(dt);
      this.sand.update(dt);
      this.fx.update(dt, this.ball, viewer.getWorldPosition(tmp));
      this.ocean.update(time);
      this.scenery.update(time);
      this.crowd.update(dt, time);
      this.audio.update(dt, viewer);
      this.banner.update(dt, viewer.getWorldPosition(tmp));
      this.vrMenu.update(dt);
      if (presenting && this.watch.update(dt, this.rig)) this.toggleMenu();
      this.#updateTags(viewer);
      this.governor.update(dt);
      if (!presenting) this.view.update(dt);

      boardTimer -= dt;
      if (boardTimer <= 0) {
        boardTimer = 0.5;
        this.#updateBoard();
        this.bus.emit('stats', { fps: this.governor.fps });
      }

      this.sand.points.material.uniforms.uScale.value = presenting
        ? 1100
        : this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));

      this.renderer.render(this.scene, this.camera);
    });
  }

  /**
   * Avança só a simulação (física, regras, bots), sem desenhar. Usado em testes
   * automáticos para jogar uma partida inteira em segundos.
   */
  simulate(seconds, dt = 1 / 72) {
    const steps = Math.ceil(seconds / dt);
    for (let i = 0; i < steps; i++) {
      this.time += dt;
      this.physics.step(dt);
      this.match.update(dt, this.ball.position);
      this.director.update(dt);
      this.ball.render(this.physics.alpha, dt);
      this.replay.stop();
    }
    return { state: this.match.state, score: { ...this.match.score }, sets: { ...this.match.sets } };
  }

  /* ---------- Modos ---------- */

  /** Partida: em VR você joga; no navegador vira demonstração com 4 bots. */
  startMatch({ demo = !this.renderer.xr.isPresenting } = {}) {
    this.audio.unlock();
    this.mode = demo ? 'demo' : 'match';
    this.director.setDemo(demo);
    this.director.setVisible(true);
    this.machine.group && (this.machine.group.visible = false);
    this.board.panel?.mesh && (this.board.panel.mesh.visible = false);
    this.replay.stop();
    this.replay.reset();
    this.vrMenu.hide();
    const [a1, a2] = this.director.members('A');
    this.match.start({ teams: { A: [a1, a2], B: this.director.rivals }, bestOf: this.settings.bestOf, firstServe: 'B' });
    this.banner.show('BORA!', `${this.difficulty.label} · ${this.settings.bestOf === 1 ? '1 set até 21' : 'melhor de 3'}`, { color: '#2dd4bf', duration: 1.8 });
    this.bus.emit('game:mode', { mode: this.mode });
    this.#refreshScore();
  }

  startTraining() {
    this.mode = 'training';
    this.match.stop();
    this.director.setDemo(false);
    this.director.setVisible(true);
    this.director.idleAround();
    this.machine.group && (this.machine.group.visible = true);
    this.board.panel?.mesh && (this.board.panel.mesh.visible = true);
    this.replay.stop();
    this.vrMenu.hide();
    this.parkBall();
    this.bus.emit('game:mode', { mode: this.mode });
    this.#refreshScore();
  }

  setDifficulty(key) {
    if (!DIFFICULTY[key]) return;
    this.settings.difficulty = key;
    this.bus.emit('game:settings', { ...this.settings });
    this.#refreshMenu();
  }

  setBestOf(n) {
    this.settings.bestOf = n === 3 ? 3 : 1;
    this.bus.emit('game:settings', { ...this.settings });
    this.#refreshMenu();
  }

  toggleMenu() {
    if (this.vrMenu.open) {
      this.vrMenu.hide();
      return;
    }
    const page = this.match.state === 'gameover' ? 'gameover' : this.mode === 'match' && this.match.playing ? 'pause' : 'main';
    this.vrMenu.show(page, this.#menuData(), this.rig.head, this.rig.headForward);
  }

  /* ---------- Ações de treino ---------- */

  playerPosition(out = new THREE.Vector3()) {
    if (this.renderer.xr.isPresenting) return this.renderer.xr.getCamera().getWorldPosition(out);
    return out.set(PLAYER.spawn.x, PLAYER.eyeHeight, PLAYER.spawn.z);
  }

  machineServe() {
    if (this.mode !== 'training') return;
    this.audio.unlock();
    this.machine.serveTo(this.playerPosition(tmp));
    this.serves++;
  }

  /** Saque de demonstração (navegador): do fundo para o lado adversário. */
  playerServe() {
    if (this.mode !== 'training') return;
    this.audio.unlock();
    const from = new THREE.Vector3(PLAYER.spawn.x, 2.35, COURT.halfLength + 0.6);
    const target = new THREE.Vector3((Math.random() - 0.5) * (COURT.width - 1.5), BALL.radius, -1.5 - Math.random() * (COURT.halfLength - 2.2));
    const velocity = new THREE.Vector3();
    let flight = 1.55;
    for (let i = 0; i < 10; i++) {
      solveLaunch(from, target, flight, undefined, velocity);
      const atNet = heightAtNet(from, velocity);
      if (atNet && atNet.y > NET.topHeight + 0.4) break;
      flight += 0.08;
    }
    this.ball.launch(from, velocity, { x: -6, y: 0, z: 0 });
    this.audio.play('serve', from);
    this.serves++;
  }

  parkBall() {
    const p = this.playerPosition(tmp);
    this.ball.park(new THREE.Vector3(p.x, 1.25, p.z - 0.9));
  }

  /* ---------- Internos ---------- */

  #strikerContext() {
    return {
      assist: () => this.difficulty.assist,
      active: () => !this.vrMenu.open && !this.replay.playing && this.mode !== 'demo',
      touchIndex: () => {
        const m = this.match;
        if (m.mode !== 'match') return 1;
        if (m.state === 'serve') return 3;
        return m.touches.team === 'A' ? m.touches.count + 1 : 1;
      },
      partnerTarget: (kind) => {
        const p = this.director.partner.position;
        if (kind === 'pass') return { point: new THREE.Vector3(THREE.MathUtils.clamp(p.x * 0.4, -1.6, 1.6), 2.3, 1.7), flight: 1.45 };
        const reach = 2.35 + 0.62;
        return { point: new THREE.Vector3(THREE.MathUtils.clamp(p.x, -2.8, 2.8), reach - 0.12, 1.0), flight: 1.3 };
      },
      opponentTarget: () => new THREE.Vector3((Math.random() - 0.5) * 5.5, 0.5, -(2.2 + Math.random() * 4.6)),
    };
  }

  #updateHuman(viewer, presenting) {
    if (presenting) {
      viewer.getWorldPosition(this.human.head);
    } else {
      this.human.head.set(PLAYER.spawn.x, PLAYER.eyeHeight, PLAYER.spawn.z);
    }
    this.human.position.set(this.human.head.x, 0, this.human.head.z);
  }

  /** Bola do saque flutuando na frente do jogador até ele lançar (pinça/gatilho) ou bater. */
  #updateHumanServe() {
    const m = this.match;
    if (this.mode !== 'match' || m.state !== 'serve' || m.server !== this.human || this.serveTossed) return;
    const f = this.rig.headForward.clone().setY(0).normalize();
    const p = this.human.head.clone().addScaledVector(f, 0.5);
    p.y = this.human.head.y - 0.3;
    this.ball.hold(p);
  }

  #tossServe() {
    if (this.mode !== 'match' || this.match.state !== 'serve' || this.match.server !== this.human || this.serveTossed) return;
    this.serveTossed = true;
    const p = this.ball.position.clone();
    this.ball.launch(p, new THREE.Vector3(0, 4.3, 0), { x: 0, y: 1, z: 0 });
    this.audio.play('click', p, { volume: 0.4 });
  }

  /** Mão atravessando a rede durante o rally é falta. */
  #checkHumanNetTouch(dt) {
    this.netFaultCooldown = Math.max(0, this.netFaultCooldown - dt);
    if (this.mode !== 'match' || !this.match.live || this.netFaultCooldown > 0) return;
    for (const side of this.rig.sides) {
      if (!side.visible) continue;
      for (const tip of side.tips) {
        const inNet = Math.abs(tip.z) < 0.03 && Math.abs(tip.x) < NET.width / 2 && tip.y > NET.topHeight - NET.height && tip.y < NET.topHeight + 0.02;
        if (inNet) {
          this.netFaultCooldown = 2;
          this.court.hitNet(4, -1);
          this.match.humanNetFault('A');
          return;
        }
      }
    }
  }

  #wireEvents() {
    const bus = this.bus;

    bus.on('ball:contact', ({ surface, position, speed, velocity }) => {
      this.lastSurface = surface;
      if (surface === 'sand' && speed > 1.5) {
        this.sand.emit(position, speed / 9);
        if (speed > 3) this.audio.play('sand', position, { volume: Math.min(1, speed / 14) });
      }
      if (surface === 'net') {
        this.court.hitNet(speed, velocity.z);
        this.audio.play('net', position, { volume: Math.min(1, speed / 12) });
      }
      if (surface === 'post' || surface === 'antenna') this.audio.play('post', position, { volume: Math.min(1, speed / 10) });
    });

    bus.on('ball:hit', ({ actor, kind, position, speed }) => {
      this.audio.play(HIT_SOUND[kind] ?? 'hit', position, { volume: Math.min(1, 0.35 + speed / 22) });
      const strong = kind === 'spike' || kind === 'block' || speed > 14;
      this.fx.impact(position, actor.team === 'A' ? 0xffc27a : 0x7ff0e0, strong ? 0.55 : 0.35);
      if (strong) this.sand.emit(new THREE.Vector3(position.x, 0.05, position.z), 0.15);
      if (actor === this.human) this.lastHumanHit = { kind, speed, time: this.time };
      if (this.match.live) this.audio.setCrowdExcitement(Math.min(1, 0.3 + this.match.rallyTouches * 0.06));
    });

    bus.on('ball:lost', () => {
      if (this.mode === 'training') this.parkBall();
    });

    bus.on('bot:dive', ({ position }) => this.audio.play('dive', position));
    bus.on('ui:click', () => this.audio.play('click', null, { volume: 0.5 }));

    bus.on('xr:select', ({ index }) => {
      if (this.vrMenu.open) return;
      if (this.mode === 'training') this.machineServe();
      else if (this.mode === 'match') this.#tossServe();
      void index;
    });
    bus.on('xr:squeeze', () => this.toggleMenu());

    bus.on('xr:start', () => {
      this.audio.unlock();
      this.locomotion.begin();
      this.startTraining();
      // Menu principal na frente do jogador logo ao entrar.
      setTimeout(() => {
        if (!this.renderer.xr.isPresenting) return;
        this.rig.update(0, this.renderer.xr.getCamera());
        this.vrMenu.show('main', this.#menuData(), this.rig.head, this.rig.headForward);
      }, 600);
    });
    bus.on('xr:end', () => {
      this.locomotion.end();
      this.vrMenu.hide();
      this.startTraining();
    });

    bus.on('menu:action', ({ action, value }) => {
      if (action === 'play' || action === 'restart') this.startMatch({ demo: false });
      else if (action === 'training') this.startTraining();
      else if (action === 'resume' || action === 'close') this.vrMenu.hide();
      else if (action === 'difficulty') this.setDifficulty(value);
      else if (action === 'bestOf') this.setBestOf(value);
      else if (action === 'recenter') {
        this.locomotion.recenter();
        this.vrMenu.hide();
      } else if (action === 'replay') {
        this.settings.replay = !this.settings.replay;
        this.#refreshMenu();
      }
    });

    /* Partida */
    bus.on('match:serve', ({ server, team }) => {
      this.serveTossed = false;
      this.fx.clearTrail();
      this.director.prepareServe(server);
      this.audio.setCrowdExcitement(0.25);
      const you = server === this.human;
      if (!you && !server.isHuman) {
        // A bola vai para a mão do sacador bot.
        this.ball.hold(new THREE.Vector3(server.position.x, 1.1, server.position.z));
      }
      const subtitle = you ? 'Pinça ou gatilho lança a bola. Ou bata direto nela.' : `${server.name} saca${team === 'A' ? ' pelo seu time' : ''}`;
      this.banner.show(you ? 'SEU SAQUE' : 'SAQUE', subtitle, { color: TEAMS[team].accent, duration: you ? 2.6 : 1.6 });
      this.#refreshScore();
    });

    bus.on('match:serveReady', () => this.audio.play('whistle', new THREE.Vector3(-COURT.halfWidth - 2, 2.5, 0), { volume: 0.7 }));

    bus.on('match:serveDrop', () => {
      if (this.match.server === this.human) this.serveTossed = false;
    });

    bus.on('match:point', (p) => {
      this.director.celebrate(p.winner);
      const ours = p.winner === 'A';
      const rallyHeat = Math.min(1, 0.45 + p.rallyTouches * 0.07);
      this.crowd.cheer(ours ? rallyHeat : rallyHeat * 0.6);
      this.audio.cheer(ours ? rallyHeat : rallyHeat * 0.55);
      this.audio.setCrowdExcitement(ours ? 0.9 : 0.5);
      this.audio.play('whistle', new THREE.Vector3(-COURT.halfWidth - 2, 2.5, 0), { volume: 0.8 });
      if (ours) this.audio.play('point', null, { volume: 0.55 });

      const by = p.lastActor && p.reason === 'in' && p.winner === p.lastActor.team ? `${HIT_LABEL[p.lastKind] ?? 'Ponto'} de ${p.lastActor === this.human ? 'você' : p.lastActor.name}` : p.reasonText;
      const title = p.gameOver ? 'FIM DE JOGO' : p.setOver ? 'FIM DO SET' : ours ? 'PONTO!' : 'PONTO DELES';
      const score = `${p.score.A} × ${p.score.B}`;
      this.banner.show(title, `${by} · ${score}${p.setPoint ? ' · SET POINT' : ''}`, { color: ours ? TEAMS.A.accent : TEAMS.B.accent, duration: 2.4 });
      this.#refreshScore();

      // Replay em câmera lenta de lances bons: rally longo, cortada ou bloqueio.
      const highlight = p.rallyTouches >= 5 || p.lastKind === 'spike' || p.lastKind === 'block' || p.reason === 'in' && p.rallyTouches >= 3;
      if (this.settings.replay && highlight && !p.gameOver) {
        setTimeout(() => {
          if (this.match.state !== 'point') return;
          const duration = this.replay.start();
          if (duration > 0) {
            this.match.extendPoint(duration + 0.8);
            this.banner.show('REPLAY', 'câmera lenta', { color: '#ffb35c', duration: Math.min(duration, 6) });
            this.bus.emit('replay:start', { duration });
          }
        }, 1300);
      }
    });

    bus.on('match:newSet', ({ setIndex }) => {
      this.banner.show(`SET ${setIndex + 1}`, `Sets ${this.match.sets.A} × ${this.match.sets.B}`, { color: '#2dd4bf', duration: 2 });
    });

    bus.on('match:over', ({ winner, history }) => {
      this.audio.play('whistleLong', new THREE.Vector3(-COURT.halfWidth - 2, 2.5, 0));
      this.audio.play('gameover', null, { volume: 0.6 });
      this.crowd.cheer(1);
      this.audio.cheer(winner === 'A' ? 1.3 : 0.7);
      this.director.celebrate(winner);
      this.#refreshScore();
      if (this.renderer.xr.isPresenting && this.mode === 'match') {
        this.vrMenu.show('gameover', { ...this.#menuData(), winner, history }, this.rig.head, this.rig.headForward);
      }
      // A demonstração recomeça sozinha.
      if (this.mode === 'demo') setTimeout(() => this.mode === 'demo' && this.startMatch({ demo: true }), 6000);
    });
  }

  #menuData() {
    return {
      difficulty: this.settings.difficulty,
      difficultyLabel: this.difficulty.label,
      bestOf: this.settings.bestOf,
      replay: this.settings.replay,
    };
  }

  #refreshMenu() {
    if (this.vrMenu.open) this.vrMenu.setData(this.#menuData());
  }

  #refreshScore() {
    const m = this.match;
    const inMatch = this.mode !== 'training';
    const state = {
      score: inMatch ? m.score : { A: 0, B: 0 },
      sets: m.sets,
      serving: inMatch ? m.servingTeam : null,
      setIndex: m.setIndex,
      bestOf: m.bestOf,
      teamA: this.mode === 'demo' ? 'DUDA + BIA' : 'VOCÊ + DUDA',
      label: inMatch ? (m.state === 'gameover' ? 'FINAL' : `SET ${m.setIndex + 1}${m.bestOf > 1 ? ` DE ${m.bestOf}` : ''} · ${this.difficulty.label.toUpperCase()}`) : 'TREINO LIVRE',
    };
    this.scoreboard.update(state);
    this.watch.setState({ a: state.score.A, b: state.score.B, label: inMatch ? `SET ${m.setIndex + 1}` : 'TREINO' });
    this.bus.emit('score', { ...state, mode: this.mode, state: m.state });
  }

  #updateTags(viewer) {
    const eye = viewer.getWorldPosition(tmp);
    for (const { bot, tag } of this.tags) {
      const visible = bot.athlete.root.visible && this.mode !== 'training';
      tag.visible = visible;
      if (!visible) continue;
      tag.position.set(bot.athlete.root.position.x, 2.2 + bot.jump.height, bot.athlete.root.position.z);
      tag.lookAt(eye.x, tag.position.y, eye.z);
      const d = eye.distanceTo(tag.position);
      tag.scale.setScalar(THREE.MathUtils.clamp(d / 9, 0.6, 2.2));
    }
  }

  #updateBoard() {
    this.board.update({
      fps: this.governor.fps,
      frameRate: this.xr.frameRate,
      foveation: this.governor.foveation,
      ballSpeed: this.ball.parked ? 0 : this.ball.velocity.length(),
      handTracking: this.xr.handTracking,
      lastSurface: this.lastSurface,
      serves: this.serves,
    });
  }

  #resize() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
