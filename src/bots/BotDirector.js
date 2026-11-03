import * as THREE from 'three';
import { BALL, COURT, NET, TEAMS } from '../config.js';
import { heightAtNet, predictTrajectory, solveLaunch } from '../physics/trajectory.js';
import { Bot } from './Bot.js';

const JUMP_BY_LEVEL = { easy: 0.5, normal: 0.62, hard: 0.76 };
const READ = { easy: 0.45, normal: 0.6, hard: 0.72 };
const REACH = { bump: 0.62, set: 0.55, attack: 0.55, free: 0.62, dig: 0.85 };

const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const sideOf = (z) => (z >= 0 ? 'A' : 'B');
const signOf = (team) => TEAMS[team].sign;

/**
 * Cérebro coletivo dos bots.
 *
 * A cada toque (ou saque) prevê a trajetória com o mesmo modelo da física e decide:
 * quem do time vai na bola, onde ficar, quando saltar ou mergulhar, e para onde mandar
 * (passe para o levantador → levantamento para o atacante → ataque/largada).
 * O parceiro do jogador não rouba bolas: só entra quando a bola é claramente dele
 * ou quando o jogador não pode tocar (acabou de tocar).
 * Erros vêm só de limites: reação, velocidade, alcance e imprecisão por dificuldade.
 */
export class BotDirector {
  constructor({ scene, bus, ball, hitSystem, match, human, physics, getDifficulty }) {
    this.bus = bus;
    this.ball = ball;
    this.hits = hitSystem;
    this.match = match;
    this.human = human;
    this.getDifficulty = getDifficulty;
    this.clock = 0;
    this.serveTimeline = null;

    const make = (cfg) => new Bot(scene, cfg);
    this.partner = make({ id: 'duda', name: 'Duda', team: 'A', sign: 1, jersey: TEAMS.A.color, skin: 0xb9805a, hair: 0x1d120a, number: 2, isPartner: true });
    this.autoPlayer = make({ id: 'auto', name: 'Bia', team: 'A', sign: 1, jersey: TEAMS.A.color, skin: 0xe0ac86, hair: 0x6b4423, number: 1 });
    this.rivals = [
      make({ id: 'rafa', name: 'Rafa', team: 'B', sign: -1, jersey: TEAMS.B.color, skin: 0x8d5a3b, hair: 0x120a06, number: 7 }),
      make({ id: 'leo', name: 'Léo', team: 'B', sign: -1, jersey: TEAMS.B.color, skin: 0xd9a27a, hair: 0xc9a25a, number: 11 }),
    ];
    this.bots = [this.partner, this.autoPlayer, ...this.rivals];
    this.demo = false;
    this.setDemo(false);

    // Bloqueio: as mãos dos bots viram colisores durante o salto.
    for (const bot of this.rivals.concat(this.partner)) {
      const hands = [
        { kind: 'block', radius: 0.12, a: new THREE.Vector3(0, -10, 0), prevA: new THREE.Vector3(0, -10, 0) },
        { kind: 'block', radius: 0.12, a: new THREE.Vector3(0, -10, 0), prevA: new THREE.Vector3(0, -10, 0) },
      ];
      bot.blockHands = hands;
      hitSystem.add({
        actor: bot,
        frameDt: 1 / 72,
        enabled: () => bot.blocking && bot.jump.active,
        colliders: () => hands,
        resolve: (contact) => this.#resolveBlock(bot, contact),
      });
    }

    physics.preStep.push((dt) => this.#preStep(dt));
    bus.on('ball:hit', (e) => this.#afterHit(e));
    bus.on('ball:contact', (e) => { if (e.surface === 'net' && this.match.live) this.replan(0.1); });
  }

  /** Modo demonstração: um bot joga no lugar do jogador. */
  setDemo(on) {
    this.demo = on;
    this.autoPlayer.athlete.root.visible = on;
    this.autoPlayer.athlete.shadow.visible = on;
  }

  setVisible(on) {
    for (const bot of this.bots) {
      const show = on && (bot !== this.autoPlayer || this.demo);
      bot.athlete.root.visible = show;
      bot.athlete.shadow.visible = show;
    }
  }

  get humanSlot() {
    return this.demo ? this.autoPlayer : this.human;
  }

  members(team) {
    return team === 'A' ? [this.humanSlot, this.partner] : this.rivals;
  }

  activeBots() {
    return this.demo ? this.bots : this.bots.filter((b) => b !== this.autoPlayer);
  }

  teammate(actor) {
    return this.members(actor.team).find((m) => m !== actor);
  }

  get difficulty() {
    return this.getDifficulty();
  }

  get jumpHeight() {
    return JUMP_BY_LEVEL[this.difficulty.key] ?? 0.62;
  }

  /* ---------- Saque ---------- */

  /** Posiciona os times para o saque. Se o sacador é bot, agenda lançamento e batida. */
  prepareServe(server) {
    this.serveTimeline = null;
    for (const bot of this.bots) {
      bot.plan = null;
      bot.blocking = false;
      bot.setPose('ready');
    }
    for (const team of ['A', 'B']) {
      const s = signOf(team);
      const [m1, m2] = this.members(team);
      const serving = server.team === team;
      for (const [i, m] of [m1, m2].entries()) {
        if (m.isHuman) continue;
        if (m === server) {
          m.moveTo(new THREE.Vector3(i === 0 ? 1.4 : -1.4, 0, s * (COURT.halfLength + 0.8)), { urgency: 0.7 });
        } else if (serving) {
          m.moveTo(new THREE.Vector3(this.#otherHalfX(team, m, 1.4), 0, s * 1.4), { urgency: 0.7 });
        } else {
          m.moveTo(new THREE.Vector3(this.#otherHalfX(team, m, 2.0), 0, s * 5.6), { urgency: 0.7 });
        }
        m.lookAt.set(0, 1, -s * 4);
      }
    }
    if (!server.isHuman) this.serveTimeline = { server, t: 0, phase: 'walk' };
  }

  /** Para bots do time A, fica na metade oposta à do jogador; senão, metade padrão. */
  #otherHalfX(team, member, spread) {
    if (team === 'A') {
      const mate = this.teammate(member);
      const mx = mate.isHuman ? this.human.position.x : mate.target.x;
      return mx > 0.2 ? -spread : spread;
    }
    return member === this.rivals[0] ? -spread : spread;
  }

  #runServe(dt) {
    const tl = this.serveTimeline;
    if (!tl) return;
    const bot = tl.server;
    tl.t += dt;
    const hand = bot.athlete.handWorld(0, new THREE.Vector3());
    if (tl.phase === 'walk') {
      this.ball.hold(new THREE.Vector3(hand.x, Math.max(hand.y, 1.0), hand.z));
      const arrived = bot.position.distanceTo(bot.target) < 0.15;
      if (arrived && tl.t > 1.2 && this.match.state === 'serve' && this.match.serveReady) {
        tl.phase = 'toss';
        tl.t = 0;
        bot.setPose('toss');
        bot.lookAt.set(bot.position.x * 0.3, 1, -bot.sign * 6);
      }
    } else if (tl.phase === 'toss') {
      this.ball.hold(new THREE.Vector3(hand.x, Math.max(hand.y, 1.0), hand.z));
      if (tl.t > 0.45) {
        const jump = this.difficulty.jumpServe;
        this.ball.launch(new THREE.Vector3(bot.position.x, 2.0, bot.position.z + bot.sign * -0.25), new THREE.Vector3(0, jump ? 5.6 : 4.4, -bot.sign * (jump ? 1.2 : 0.3)));
        tl.phase = 'air';
        tl.t = 0;
        if (jump) bot.startJump(0.55);
      }
    } else if (tl.phase === 'air') {
      bot.setPose(tl.t < 0.3 ? 'spikeLoad' : 'spikeSwing');
      const apex = this.difficulty.jumpServe ? 0.5 : 0.38;
      if (tl.t >= apex) {
        this.serveTimeline = null;
        this.#executeServe(bot);
      }
    }
  }

  #executeServe(bot) {
    const d = this.difficulty;
    const from = this.ball.position.clone();
    const receivers = this.members(bot.team === 'A' ? 'B' : 'A');
    const receiver = receivers[0].isHuman || this.demo ? (Math.random() < 0.6 ? receivers[0] : receivers[1]) : receivers[Math.random() < 0.5 ? 0 : 1];
    const rs = signOf(receiver.team);
    const rp = receiver.isHuman ? this.human.position : receiver.position;
    const target = new THREE.Vector3(
      THREE.MathUtils.clamp(rp.x + gauss() * d.precision * 0.6, -COURT.halfWidth + 0.4, COURT.halfWidth - 0.4),
      0.3,
      rs * THREE.MathUtils.clamp(Math.abs(rp.z) + 0.6 + gauss() * d.precision * 0.5, 2.5, COURT.halfLength - 0.5),
    );
    const topspin = d.jumpServe || Math.random() < 0.3;
    const dir = new THREE.Vector3(target.x - from.x, 0, target.z - from.z).normalize();
    const spin = topspin ? new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(26) : new THREE.Vector3();
    const velocity = this.#clearNet(from, target, d.serveFlight * (topspin ? 0.88 : 1), spin, 0.35);
    this.hits.apply(bot, 'serve', velocity, spin);
    bot.setPose('spikeSwing', 0.4);
  }

  /* ---------- Planejamento do rally ---------- */

  #afterHit(e) {
    if (!this.match.live && this.match.state !== 'serve') return;
    this.replan(0);
  }

  /** Recalcula quem vai na bola e onde cada um fica. */
  replan(extraDelay = 0) {
    if (!this.match.live) return;
    const snap = this.ball.snapshot();
    const samples = predictTrajectory(snap.position, snap.velocity, snap.spin, { maxTime: 4.5, sampleEvery: 1 / 60 });
    if (samples.length < 2) return;

    const startSide = sideOf(samples[0].z);
    let cross = -1;
    for (let i = 1; i < samples.length; i++) {
      if (sideOf(samples[i].z) !== startSide && Math.abs(samples[i].z) > 0.05) { cross = i; break; }
    }
    const receiving = cross >= 0 ? sideOf(samples[cross].z) : startSide;
    const window = cross >= 0 ? samples.slice(cross) : samples;
    const touches = this.match.touches;
    const k = touches.team === receiving ? touches.count + 1 : 1;
    const d = this.difficulty;

    for (const bot of this.activeBots()) {
      bot.plan = null;
      bot.blocking = false;
      bot.lookAt.copy(this.ball.position);
    }

    // Leitura do ataque: contra bola forte, às vezes o defensor demora a reagir.
    // É limite de dificuldade (tempo de reação), não erro proposital.
    const incoming = snap.velocity.length();
    let delay = extraDelay;
    if (k === 1 && incoming > 11 && Math.random() > (READ[d.key] ?? 0.7)) delay += 0.28 + Math.random() * 0.2;

    const other = receiving === 'A' ? 'B' : 'A';
    let assigned = null;
    if (k <= 3) assigned = this.#assignTouch(receiving, k, window, d, delay);
    this.#support(receiving, k, assigned, window);
    this.#defend(other, receiving, k, window, assigned);
  }

  #windowFor(kind, s, sign) {
    const ownSide = s.z * sign > 0.3 && s.z * sign < COURT.halfLength + 2.5 && Math.abs(s.x) < COURT.halfWidth + 2.5;
    if (!ownSide) return false;
    const descending = s.vy < 0;
    if (kind === 'bump' || kind === 'free') return descending && s.y > 0.45 && s.y < 1.2;
    if (kind === 'set') return descending && s.y > 1.95 && s.y < 2.5;
    if (kind === 'attack') return s.z * sign < 3.2 && s.y > 2.45 && s.y < Bot.reach(this.jumpHeight) + 0.05;
    return false;
  }

  /** Posição dos pés para que o ponto de contato do golpe coincida com a bola. */
  #standFor(kind, s, sign) {
    const back = kind === 'bump' || kind === 'free' ? 0.42 : kind === 'set' ? 0.15 : 0.25;
    return new THREE.Vector3(s.x, 0, s.z + sign * back);
  }

  #feasible(bot, kind, window, d, delay) {
    let best = null;
    let closestMiss = null;
    for (const s of window) {
      if (!this.#windowFor(kind, s, bot.sign)) continue;
      const stand = this.#standFor(kind, s, bot.sign);
      const dist = Math.hypot(stand.x - bot.position.x, stand.z - bot.position.z);
      const travel = dist / d.runSpeed + d.reaction + delay + (dist > 0.3 ? 0.18 : 0);
      if (travel <= s.t) {
        best = { s, stand, dist };
        break;
      }
      const miss = travel - s.t;
      if (!closestMiss || miss < closestMiss.miss) closestMiss = { s, stand, dist, miss };
    }
    return { best, closestMiss };
  }

  #assignTouch(team, k, window, d, delay) {
    const sign = signOf(team);
    const members = this.members(team);
    const touches = this.match.touches;
    const last = touches.team === team && !touches.lastWasBlock ? touches.lastActor : null;
    const eligible = members.filter((m) => m !== last);

    // Tipo de toque desejado.
    const kinds = k === 1 ? ['bump'] : k === 2 ? ['set', 'bump'] : ['attack', 'free'];

    // Jogador humano: a bola é "dele" se o ponto de defesa passa perto dele.
    const human = this.humanSlot.isHuman ? this.humanSlot : null;
    let humanBall = false;
    if (human && eligible.includes(human)) {
      let bestD = Infinity;
      for (const s of window) {
        if (!(s.z * sign > 0.2) || s.y > 2.9) continue;
        const dd = Math.hypot(s.x - human.position.x, s.z - human.position.z);
        if (s.y < 2.6) bestD = Math.min(bestD, dd);
      }
      humanBall = bestD < 2.4;
      this.humanDistance = bestD;
    }

    let choice = null;
    for (const kind of kinds) {
      for (const m of eligible) {
        if (m.isHuman) continue;
        const { best, closestMiss } = this.#feasible(m, kind, window, d, delay);
        if (best) {
          const cand = { bot: m, kind, ...best };
          if (!choice || cand.s.t < choice.s.t || (cand.s.t === choice.s.t && cand.dist < choice.dist)) choice = cand;
        } else if (closestMiss && kind !== 'attack' && closestMiss.miss < 0.3 && !choice) {
          choice = { bot: m, kind: 'dig', ...closestMiss, dive: true };
        }
      }
      if (choice) break;
    }

    if (!choice) return null;
    // Parceiro respeita a bola do jogador: só entra se o jogador estiver bem mais longe.
    if (choice.bot.isPartner && humanBall) {
      const partnerD = choice.dist;
      if (!(partnerD + 1.2 < (this.humanDistance ?? Infinity)) || k === 1) return { human: true };
    }

    const bot = choice.bot;
    const t0 = this.clock;
    bot.plan = {
      kind: choice.kind === 'dig' ? 'bump' : choice.kind,
      k,
      sample: choice.s,
      stand: choice.stand,
      contactTime: t0 + choice.s.t,
      dive: Boolean(choice.dive),
      jumpAt: null,
      done: false,
    };
    bot.moveTo(choice.stand, { urgency: 1, delay: d.reaction + delay });
    if (bot.plan.kind === 'attack') {
      const h = THREE.MathUtils.clamp(choice.s.y - Bot.reach(0), 0.12, this.jumpHeight);
      bot.plan.jumpHeight = h;
      bot.plan.jumpAt = bot.plan.contactTime - Bot.timeToApex(h);
    }
    return { bot, plan: bot.plan };
  }

  /** Quem não vai na bola se prepara para a próxima jogada. */
  #support(team, k, assigned, window) {
    const sign = signOf(team);
    for (const m of this.members(team)) {
      if (m.isHuman || (assigned && assigned.bot === m)) continue;
      const landing = window[window.length - 1];
      if (k === 1) {
        // Vai para a posição de levantador perto da rede.
        m.moveTo(new THREE.Vector3(THREE.MathUtils.clamp(landing.x * 0.3, -1.5, 1.5), 0, sign * 2.0), { urgency: 0.8, delay: this.difficulty.reaction });
      } else if (k === 2) {
        // Quem passou abre para atacar.
        const x = THREE.MathUtils.clamp(m.position.x, -2.6, 2.6);
        m.moveTo(new THREE.Vector3(x, 0, sign * 3.2), { urgency: 0.9, delay: this.difficulty.reaction });
      } else {
        m.moveTo(new THREE.Vector3(m.position.x * 0.6, 0, sign * 4.2), { urgency: 0.7 });
      }
    }
  }

  /** Time sem a bola: bloqueio na rede quando vem ataque, defesa no fundo. */
  #defend(team, attackingTeam, k, window, assigned) {
    const sign = signOf(team);
    const members = this.members(team).filter((m) => !m.isHuman);
    if (!members.length) return;
    const d = this.difficulty;
    const attackSample = window.find((s) => s.z * signOf(attackingTeam) < 2.8 && s.y > 2.2);
    const willAttack = k >= 2 && attackSample && team === 'B';

    if (willAttack) {
      // Bloqueador: o mais perto da rede. Erro de posicionamento depende da dificuldade.
      const sorted = [...members].sort((a, b) => Math.abs(a.position.z) - Math.abs(b.position.z));
      const blocker = sorted[0];
      const defender = sorted[1];
      const bx = THREE.MathUtils.clamp(attackSample.x + gauss() * d.blockError * 0.5, -3.6, 3.6);
      blocker.moveTo(new THREE.Vector3(bx, 0, sign * 0.45), { urgency: 1, delay: d.reaction });
      blocker.blocking = true;
      blocker.blockAt = this.clock + attackSample.t - Bot.timeToApex(0.6) + 0.05 + Math.abs(gauss()) * d.blockError * 0.15;
      blocker.lookAt.set(bx, 2, -sign * 2);
      if (defender) defender.moveTo(new THREE.Vector3(-Math.sign(bx || 1) * 1.6, 0, sign * 5.6), { urgency: 0.9, delay: d.reaction });
      return;
    }

    for (const m of members) {
      let x;
      if (team === 'A' && !this.demo) {
        // Parceiro cobre a metade da quadra que o jogador não cobre.
        x = this.humanSlot.position.x > 0.2 ? -1.9 : 1.9;
      } else {
        x = m === members[0] ? -1.9 : 1.9;
      }
      m.moveTo(new THREE.Vector3(x, 0, sign * 5.2), { urgency: 0.85, delay: d.reaction });
    }
  }

  /* ---------- Execução por subpasso de física ---------- */

  #preStep(dt) {
    this.clock += dt;
    if (!this.match.live && this.match.state !== 'serve') return;
    const ball = this.ball;
    for (const bot of this.activeBots()) {
      // Mãos de bloqueio acompanham o salto.
      if (bot.blockHands) {
        for (let i = 0; i < 2; i++) {
          const c = bot.blockHands[i];
          c.prevA.copy(c.a);
          if (bot.blocking && bot.jump.active) bot.athlete.handWorld(i, c.a);
          else c.a.set(0, -10, 0);
          if (c.prevA.y < -5) c.prevA.copy(c.a);
        }
      }
      if (bot.blocking && bot.blockAt && this.clock >= bot.blockAt && !bot.jump.active) {
        bot.blockAt = null;
        bot.startJump(0.6);
        bot.setPose('block', 0.8);
      }

      const plan = bot.plan;
      if (!plan || plan.done) continue;

      if (plan.jumpAt && this.clock >= plan.jumpAt && !bot.jump.active) {
        bot.startJump(plan.jumpHeight);
        bot.setPose('spikeLoad', 0.6);
      }
      // Mergulho quando não vai chegar a tempo.
      const timeLeft = plan.contactTime - this.clock;
      const distLeft = Math.hypot(plan.stand.x - bot.position.x, plan.stand.z - bot.position.z);
      if (plan.kind === 'bump' && timeLeft < 0.42 && distLeft > 0.45 && distLeft < 2.1 && !bot.dive.active) {
        bot.startDive(new THREE.Vector3(plan.stand.x - bot.position.x, 0, plan.stand.z - bot.position.z));
        bot.setPose('dive', 1);
        plan.dive = true;
        this.bus.emit('bot:dive', { bot, position: bot.position.clone() });
      }

      if (plan.kind === 'bump' && timeLeft < 0.6) bot.setPose(bot.dive.active ? 'dive' : 'bump', 0.3);
      if (plan.kind === 'set' && timeLeft < 0.6) bot.setPose('set', 0.3);

      const kind = plan.dive ? 'dig' : plan.kind === 'free' ? 'bump' : plan.kind;
      const cp = bot.contactPoint(kind === 'dig' ? 'bump' : kind);
      if (bot.dive.active) cp.addScaledVector(bot.dive.dir, 0.45).setY(0.45);
      const reach = REACH[kind] ?? 0.6;
      if (ball.position.distanceTo(cp) < reach) {
        plan.done = true;
        this.#executeTouch(bot, plan);
      } else if (timeLeft < -0.5) {
        plan.done = true;
      }
    }
  }

  #executeTouch(bot, plan) {
    const d = this.difficulty;
    const from = this.ball.position.clone();
    const sign = bot.sign;
    const error = d.precision * (plan.dive ? 1.9 : 1);
    let kind = plan.kind;
    let target;
    let flight;
    let spin = new THREE.Vector3();

    // No 3º toque longe da rede vira bola de graça por cima (alta e segura).
    if (plan.k === 3 && (kind !== 'attack')) kind = 'free';

    if (kind === 'bump' && plan.k === 1) ({ target, flight } = this.#passTarget(bot));
    else if (kind === 'bump' || kind === 'set') ({ target, flight } = this.#setTarget(bot, kind));
    else if (kind === 'attack') ({ target, flight, spin } = this.#attackTarget(bot, from));
    else ({ target, flight } = this.#freeTarget(bot));

    target.x += gauss() * error * 0.35;
    target.z += gauss() * error * 0.35;

    let velocity;
    if (kind === 'attack' || kind === 'free') velocity = this.#clearNet(from, target, flight, spin, kind === 'attack' ? 0.12 : 0.6);
    else velocity = solveLaunch(from, target, flight, spin, new THREE.Vector3());

    const hitKind = kind === 'attack' ? 'spike' : kind === 'free' ? 'bump' : kind;
    this.hits.apply(bot, hitKind, velocity, spin);
    bot.setPose(kind === 'attack' ? 'spikeSwing' : kind === 'set' ? 'set' : plan.dive ? 'dive' : 'bump', 0.45);
    bot.lookAt.set(target.x, 1, target.z);
    void sign;
  }

  #passTarget(bot) {
    const mate = this.teammate(bot);
    const s = bot.sign;
    if (mate.isHuman) {
      const p = this.human.position;
      return { target: new THREE.Vector3(p.x, THREE.MathUtils.clamp(this.human.head.y + 0.55, 2.0, 2.6), p.z - s * 0.35), flight: 1.5 };
    }
    const x = THREE.MathUtils.clamp(this.ball.position.x * 0.3, -1.5, 1.5);
    return { target: new THREE.Vector3(x, 2.25, s * 1.6), flight: 1.35 };
  }

  #setTarget(bot) {
    const mate = this.teammate(bot);
    const s = bot.sign;
    if (mate.isHuman) {
      const p = this.human.position;
      return { target: new THREE.Vector3(p.x, this.human.head.y + 0.65, p.z - s * 0.4), flight: 1.4 };
    }
    const x = THREE.MathUtils.clamp(mate.position.x, -2.8, 2.8);
    return { target: new THREE.Vector3(x, Bot.reach(this.jumpHeight) - 0.04, s * 1.25), flight: 1.2 };
  }

  #attackTarget(bot, from) {
    const d = this.difficulty;
    const opp = bot.team === 'A' ? 'B' : 'A';
    const os = signOf(opp);
    let target;
    // Ataques "jogáveis" (na direção de um defensor) contra o jogador e em toda a demo;
    // o parceiro do jogador procura o espaço vazio em metade das vezes.
    const playable = opp === 'A' || this.demo || Math.random() < 0.5;
    if (playable) {
      // Ataques jogáveis: na direção de quem defende, com ângulo e força variados.
      const [h, p] = this.members(opp);
      const receiver = Math.random() < 0.62 ? h : p;
      const rp = receiver.isHuman ? this.human.position : receiver.position;
      const ang = Math.random() * Math.PI * 2;
      const r = d.attackSpread * (0.35 + Math.random() * 0.75);
      target = new THREE.Vector3(rp.x + Math.cos(ang) * r, 0.25, rp.z + Math.sin(ang) * r);
    } else {
      // O parceiro ataca o espaço vazio entre os rivais.
      let best = null;
      for (let i = 0; i < 24; i++) {
        const c = new THREE.Vector3((Math.random() - 0.5) * (COURT.width - 1.2), 0.4, os * (1.5 + Math.random() * (COURT.halfLength - 2.2)));
        const score = Math.min(...this.rivals.map((r) => Math.hypot(r.position.x - c.x, r.position.z - c.z)));
        if (!best || score > best.score) best = { c, score };
      }
      target = best.c;
    }
    target.x = THREE.MathUtils.clamp(target.x, -COURT.halfWidth + 0.35, COURT.halfWidth - 0.35);
    target.z = os * THREE.MathUtils.clamp(Math.abs(target.z), 1.2, COURT.halfLength - 0.5);
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    const power = d.attackSpeed * (0.82 + Math.random() * 0.3);
    const flight = THREE.MathUtils.clamp(dist / power, 0.4, 1.4);
    const dir = new THREE.Vector3(target.x - from.x, 0, target.z - from.z).normalize();
    const spin = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(18 + Math.random() * 12);
    return { target, flight, spin };
  }

  #freeTarget(bot) {
    const opp = bot.team === 'A' ? 'B' : 'A';
    const os = signOf(opp);
    return {
      target: new THREE.Vector3((Math.random() - 0.5) * 4, 0.9, os * (4 + Math.random() * 2.5)),
      flight: 1.75,
    };
  }

  /** Resolve a velocidade e aumenta o tempo de voo até a bola passar a rede com folga. */
  #clearNet(from, target, flight, spin, margin) {
    const v = new THREE.Vector3();
    let f = flight;
    for (let i = 0; i < 14; i++) {
      solveLaunch(from, target, f, spin, v);
      const h = heightAtNet(from, v, spin);
      if (!h || (h.y > NET.topHeight + BALL.radius + margin && Math.abs(h.x) < NET.antennaX - 0.2)) break;
      f += 0.07;
    }
    return v;
  }

  #resolveBlock(bot, contact) {
    const v = contact.ballVelocity;
    // Só bloqueia bola vindo do outro lado na direção da rede.
    if (Math.sign(v.z) !== bot.sign || Math.abs(v.z) < 1) return null;
    const out = new THREE.Vector3(v.x * 0.35, -Math.max(2.2, Math.abs(v.y) * 0.4), -v.z * 0.4);
    return { kind: 'block', velocity: out, spin: { x: 0, y: 0, z: 0 } };
  }

  /* ---------- Fim de ponto ---------- */

  celebrate(winner) {
    for (const bot of this.activeBots()) {
      bot.plan = null;
      bot.blocking = false;
      bot.setPose(bot.team === winner ? 'celebrate' : 'sad', 1.6);
      bot.moveTo(bot.position, { urgency: 0.3 });
    }
  }

  update(dt) {
    const d = this.difficulty;
    this.#runServe(dt);
    for (const bot of this.activeBots()) {
      if (!bot.plan && bot.poseTimer <= 0 && !bot.jump.active && !bot.dive.active) {
        bot.setPose(this.match.live ? 'ready' : 'idle');
      }
      if (this.match.live || this.match.state === 'serve') {
        if (!this.serveTimeline || this.serveTimeline.server !== bot) bot.lookAt.copy(this.ball.position);
      }
      bot.update(dt, d);
    }
  }

  /** Pose e posição inicial no treino livre (fora de partida). */
  idleAround() {
    const spots = { duda: [-2.2, 4.8], auto: [2, 5], rafa: [-1.8, -5], leo: [1.8, -5] };
    for (const bot of this.bots) {
      const [x, z] = spots[bot.id];
      bot.plan = null;
      bot.moveTo(new THREE.Vector3(x, 0, z), { urgency: 0.6 });
      bot.lookAt.set(0, 1, 0);
    }
  }
}
