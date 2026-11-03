import { BALL, COURT, MATCH, NET } from '../config.js';

const REASONS = {
  in: 'Bola no chão',
  out: 'Bola fora',
  net: 'Toque na rede',
  antenna: 'Bola na antena',
  outsideAntenna: 'Passou por fora da antena',
  under: 'Passou por baixo da rede',
  fourHits: 'Quatro toques',
  double: 'Dois toques seguidos',
  post: 'Bola no poste',
  lost: 'Bola perdida',
};

/**
 * Regras de vôlei de praia (FIVB, simplificadas onde a VR pede):
 * - rally point; set até 21 (15 no tie-break) com 2 de vantagem; partida de 1 ou 3 sets;
 * - até 3 toques por lado; o bloqueio conta como toque e o bloqueador pode tocar de novo;
 * - o mesmo jogador não toca duas vezes seguidas;
 * - bola deve cruzar a rede entre as antenas e por cima da rede;
 * - bola na linha é dentro; antena e poste são fora; jogador tocar a rede é falta;
 * - quem vence o rally saca; ao recuperar o saque o time alterna o sacador.
 *
 * Estados: idle → serve → rally → point → (serve | setover | gameover).
 */
export class Match {
  constructor(bus) {
    this.bus = bus;
    this.state = 'idle';
    this.mode = 'training';
    this.bestOf = 1;
    this.teams = { A: [], B: [] };
    this.score = { A: 0, B: 0 };
    this.sets = { A: 0, B: 0 };
    this.setIndex = 0;
    this.servingTeam = 'B';
    this.serverIndex = { A: -1, B: -1 };
    this.server = null;
    this.touches = { team: null, count: 0, lastActor: null, lastWasBlock: false, total: 0 };
    this.timer = 0;
    this.serveReady = false;
    this.lastPoint = null;
    this.rallyTouches = 0;
    this.history = [];
    this.lastBallSide = null;

    bus.on('ball:hit', (e) => this.#onHit(e));
    bus.on('ball:contact', (e) => this.#onContact(e));
    bus.on('ball:lost', () => this.live && this.#fault(this.#opponent(this.touches.team ?? this.servingTeam), 'lost'));
  }

  get live() {
    return this.state === 'rally';
  }

  get playing() {
    return this.mode === 'match' && this.state !== 'idle' && this.state !== 'gameover';
  }

  /** Começa uma partida nova. `teams`: { A: [ator, ator], B: [ator, ator] }. */
  start({ teams, bestOf = 1, firstServe = 'B' }) {
    this.mode = 'match';
    this.teams = teams;
    this.bestOf = bestOf;
    this.score = { A: 0, B: 0 };
    this.sets = { A: 0, B: 0 };
    this.setIndex = 0;
    this.servingTeam = firstServe;
    this.serverIndex = { A: -1, B: -1 };
    this.history = [];
    this.#advanceServer(firstServe);
    this.bus.emit('match:start', { bestOf });
    this.#beginServe();
  }

  stop() {
    this.mode = 'training';
    this.state = 'idle';
    this.bus.emit('match:stop', {});
  }

  touchesFor(team) {
    return this.touches.team === team ? this.touches.count : 0;
  }

  /** Quem pode tocar na bola agora (as mãos do jogador consultam isto). */
  canTouch(actor) {
    if (this.mode !== 'match') return true;
    if (this.state === 'serve') return actor === this.server;
    return this.state === 'rally';
  }

  pointsToWin() {
    const deciding = this.bestOf === 3 && this.setIndex === 2;
    return deciding ? MATCH.decidingSetPoints : MATCH.pointsPerSet;
  }

  update(dt, ballPosition) {
    if (this.mode !== 'match') return;
    this.timer += dt;

    if (this.state === 'serve' && !this.serveReady && this.timer >= MATCH.servePause) {
      this.serveReady = true;
      this.bus.emit('match:serveReady', { server: this.server });
    }

    if (this.state === 'rally') this.#checkNetCrossing(ballPosition);

    if (this.state === 'point' && this.timer >= this.pointDuration) {
      if (this.pendingEnd === 'gameover') {
        this.state = 'gameover';
        this.bus.emit('match:over', { winner: this.lastPoint.winner, sets: { ...this.sets }, score: { ...this.score }, history: this.history });
      } else if (this.pendingEnd === 'set') {
        this.setIndex++;
        this.score = { A: 0, B: 0 };
        // Novo set: quem não sacou primeiro no set anterior começa.
        this.servingTeam = this.setIndex % 2 === 1 ? 'A' : 'B';
        this.#advanceServer(this.servingTeam);
        this.bus.emit('match:newSet', { setIndex: this.setIndex });
        this.#beginServe();
      } else {
        this.#beginServe();
      }
    }
  }

  /** Estende a pausa do ponto (ex.: durante o replay). */
  extendPoint(seconds) {
    if (this.state === 'point') this.pointDuration = Math.max(this.pointDuration, this.timer + seconds);
  }

  /** Falta de rede do jogador (mãos atravessando a rede). */
  humanNetFault(team) {
    if (this.state === 'rally') this.#fault(this.#opponent(team), 'net');
  }

  /* ---------- Internos ---------- */

  #beginServe() {
    this.state = 'serve';
    this.timer = 0;
    this.serveReady = false;
    this.touches = { team: null, count: 0, lastActor: null, lastWasBlock: false, total: 0 };
    this.rallyTouches = 0;
    this.lastBallSide = this.servingTeam;
    this.bus.emit('match:serve', { server: this.server, team: this.servingTeam, score: { ...this.score }, sets: { ...this.sets } });
  }

  #advanceServer(team) {
    const list = this.teams[team];
    this.serverIndex[team] = (this.serverIndex[team] + 1) % list.length;
    this.server = list[this.serverIndex[team]];
  }

  #opponent(team) {
    return team === 'A' ? 'B' : 'A';
  }

  #onHit({ actor, kind }) {
    if (this.mode !== 'match') return;
    if (this.state === 'serve') {
      if (actor !== this.server) return;
      this.state = 'rally';
      this.timer = 0;
      this.touches = { team: actor.team, count: 0, lastActor: actor, lastWasBlock: false, total: 1, lastAt: performance.now() / 1000 };
      this.lastBallSide = actor.team;
      this.bus.emit('match:rally', { server: actor });
      return;
    }
    if (this.state !== 'rally') return;

    const t = this.touches;
    const now = performance.now() / 1000;
    // Mesmo contato "duplo" (duas mãos, antebraços) em menos de 0,35 s conta como um toque.
    if (t.lastActor === actor && now - (t.lastAt ?? 0) < 0.35) {
      t.lastAt = now;
      return;
    }
    t.lastAt = now;
    this.rallyTouches++;
    const isBlock = kind === 'block';
    if (t.team !== actor.team) {
      t.team = actor.team;
      t.count = 1;
    } else {
      if (t.lastActor === actor && !t.lastWasBlock && t.count > 0) {
        this.#fault(this.#opponent(actor.team), 'double');
        return;
      }
      t.count++;
      if (t.count > 3) {
        this.#fault(this.#opponent(actor.team), 'fourHits');
        return;
      }
    }
    t.lastActor = actor;
    t.lastWasBlock = isBlock;
    t.lastKind = kind;
    t.total++;
    this.bus.emit('match:touch', { actor, kind, count: t.count, team: t.team });
  }

  #checkNetCrossing(p) {
    const side = p.z >= 0 ? 'A' : 'B';
    if (side === this.lastBallSide) return;
    const sender = this.lastBallSide;
    this.lastBallSide = side;
    if (Math.abs(p.x) > NET.antennaX) return this.#fault(this.#opponent(sender), 'outsideAntenna');
    if (p.y < NET.topHeight - NET.height) return this.#fault(this.#opponent(sender), 'under');
  }

  #onContact({ surface, position }) {
    if (this.state !== 'rally') {
      if (this.state === 'serve' && surface === 'sand') this.bus.emit('match:serveDrop', {});
      return;
    }
    const lastTeam = this.touches.team ?? this.servingTeam;
    if (surface === 'sand') {
      const margin = BALL.radius * 0.6;
      const inside = Math.abs(position.x) <= COURT.halfWidth + margin && Math.abs(position.z) <= COURT.halfLength + margin;
      const side = position.z >= 0 ? 'A' : 'B';
      if (inside) this.#point(this.#opponent(side), 'in', position);
      else this.#point(this.#opponent(lastTeam), 'out', position);
    } else if (surface === 'antenna') {
      this.#point(this.#opponent(lastTeam), 'antenna', position);
    } else if (surface === 'post') {
      this.#point(this.#opponent(lastTeam), 'post', position);
    }
  }

  #fault(winner, reason) {
    this.#point(winner, reason, null);
  }

  #point(winner, reason, position) {
    if (this.state !== 'rally') return;
    this.state = 'point';
    this.timer = 0;
    this.pointDuration = MATCH.pointPause;
    this.score[winner]++;
    const lastKind = this.touches.lastKind;
    const lastActor = this.touches.lastActor;

    // Troca de saque: quem ganha saca; ao recuperar, alterna o sacador do time.
    if (winner !== this.servingTeam) {
      this.servingTeam = winner;
      this.#advanceServer(winner);
    }

    const target = this.pointsToWin();
    const lead = this.score[winner] - this.score[this.#opponent(winner)];
    let end = null;
    if (this.score[winner] >= target && lead >= 2) {
      this.sets[winner]++;
      const needed = Math.ceil(this.bestOf / 2);
      end = this.sets[winner] >= needed ? 'gameover' : 'set';
      this.history.push({ ...this.score });
      this.pointDuration = end === 'gameover' ? 3.2 : 3.4;
    }
    this.pendingEnd = end;

    this.lastPoint = {
      winner,
      reason,
      reasonText: REASONS[reason] ?? reason,
      position,
      lastKind,
      lastActor,
      rallyTouches: this.rallyTouches,
      score: { ...this.score },
      sets: { ...this.sets },
      setOver: end === 'set',
      gameOver: end === 'gameover',
      setPoint: !end && this.score[winner] >= target - 1 && lead >= 1,
    };
    this.bus.emit('match:point', this.lastPoint);
  }
}
