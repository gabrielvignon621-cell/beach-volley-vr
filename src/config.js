import { Vector3 } from 'three';

/**
 * Medidas oficiais de vôlei de praia (FIVB) e constantes da simulação.
 * Sistema de coordenadas: metros, Y para cima, rede no plano z = 0.
 * O lado do jogador é z > 0 e o lado adversário é z < 0.
 */
export const COURT = {
  length: 16,
  width: 8,
  halfLength: 8,
  halfWidth: 4,
  lineWidth: 0.05,
};

export const NET = {
  topHeight: 2.43,
  height: 1.0,
  width: 8.5,
  postX: 4.8,
  postRadius: 0.06,
  postHeight: 2.65,
  antennaX: 4.025,
  antennaAbove: 0.8,
  antennaRadius: 0.006,
};

export const BALL = {
  radius: 0.105,
  mass: 0.27,
};

export const PHYSICS = {
  step: 1 / 120,
  maxSubSteps: 6,
  gravity: -9.81,
  airDensity: 1.2,
  dragCoefficient: 0.32,
  // Constante de Magnus adimensional: F = C * rho * r^3 * (w x v)
  magnusCoefficient: 1.0,
};

export const PLAYER = {
  spawn: new Vector3(1.4, 0, 5.2),
  eyeHeight: 1.65,
};

export const WORLD = {
  waterLevel: -0.22,
  beachSlopeStartX: -9,
  beachSlope: 0.055,
};

// Linha da água: onde a rampa da areia cruza o nível do mar.
WORLD.shorelineX = WORLD.beachSlopeStartX + WORLD.waterLevel / WORLD.beachSlope;

// Sol de fim de tarde sobre o mar (lado -X), um pouco à frente do jogador.
export const SUN = {
  direction: new Vector3(-0.8, 0.34, -0.5).normalize(),
};

/**
 * Dificuldade: só muda limites físicos e de percepção dos bots (tempo de reação,
 * velocidade, precisão) e o quanto o jogo ajuda a mirar os golpes do jogador.
 * Os bots nunca erram de propósito.
 */
export const DIFFICULTY = {
  easy: {
    label: 'Fácil',
    reaction: 0.42,
    runSpeed: 4.2,
    accel: 8,
    precision: 0.85,
    attackSpeed: 10.5,
    serveFlight: 1.85,
    jumpServe: false,
    blockError: 0.75,
    attackSpread: 1.0,
    assist: 0.75,
  },
  normal: {
    label: 'Normal',
    reaction: 0.3,
    runSpeed: 5.2,
    accel: 10,
    precision: 0.5,
    attackSpeed: 14,
    serveFlight: 1.6,
    jumpServe: false,
    blockError: 0.45,
    attackSpread: 1.7,
    assist: 0.55,
  },
  hard: {
    label: 'Difícil',
    reaction: 0.2,
    runSpeed: 6.2,
    accel: 12,
    precision: 0.28,
    attackSpeed: 18,
    serveFlight: 1.32,
    jumpServe: true,
    blockError: 0.25,
    attackSpread: 2.6,
    assist: 0.38,
  },
};

export const MATCH = {
  pointsPerSet: 21,
  decidingSetPoints: 15,
  winBy: 2,
  pointPause: 2.6,
  servePause: 1.4,
};

export const TEAMS = {
  A: { sign: 1, label: 'Você', color: 0xff6b4a, accent: '#ff7a59' },
  B: { sign: -1, label: 'Bots', color: 0x14a3b8, accent: '#2dd4bf' },
};
