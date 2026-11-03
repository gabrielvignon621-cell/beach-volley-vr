import * as THREE from 'three';
import { SUN } from '../config.js';

/*
 * Céu art-directed: zênite azul profundo, horizonte dourado e halo do sol.
 * É renderizado UMA vez num cubemap HDR, que vira o fundo da cena, a reflexão
 * do mar e a luz ambiente (PMREM). Nenhum shader de céu roda por quadro no Quest.
 */

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uGlowStrength;
  uniform float uSunSize;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float up = clamp(h, 0.0, 1.0);

    // Três faixas: horizonte quente, meio azul-claro, zênite profundo.
    vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.22, up));
    sky = mix(sky, uZenith, smoothstep(0.18, 0.85, up));

    // Lado do sol mais quente; lado oposto um pouco mais frio.
    float s = dot(d, uSunDir);
    float toward = max(s, 0.0);
    float horizonBand = 1.0 - smoothstep(0.0, 0.35, up);
    sky += uGlow * uGlowStrength * (pow(toward, 4.0) * 0.55 * horizonBand + pow(toward, 32.0) * 0.9 + pow(toward, 400.0) * 3.0);
    sky *= mix(1.0, 0.88, max(-s, 0.0) * horizonBand);

    // Disco do sol.
    sky += vec3(1.0, 0.93, 0.82) * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, s) * 30.0;

    // Abaixo do horizonte: continua o tom do horizonte (o mar cobre esta parte).
    sky = mix(sky, uHorizon * 0.9, smoothstep(0.0, -0.08, h));
    gl_FragColor = vec4(sky, 1.0);
  }
`;

const DEFAULT_SKY = {
  zenith: 0x1f5fbf,
  mid: 0x6fa8e0,
  horizon: 0xf3d9b8,
  glow: 0xffa860,
  glowStrength: 1.0,
  sunSize: 0.0006,
};

export function createEnvironment(renderer, scene) {
  const uniforms = {
    uSunDir: { value: SUN.direction.clone() },
    uZenith: { value: new THREE.Color(DEFAULT_SKY.zenith) },
    uMid: { value: new THREE.Color(DEFAULT_SKY.mid) },
    uHorizon: { value: new THREE.Color(DEFAULT_SKY.horizon) },
    uGlow: { value: new THREE.Color(DEFAULT_SKY.glow) },
    uGlowStrength: { value: DEFAULT_SKY.glowStrength },
    uSunSize: { value: DEFAULT_SKY.sunSize },
  };
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms, side: THREE.BackSide, depthWrite: false }),
  );
  const skyScene = new THREE.Scene();
  skyScene.add(skyDome);

  const cubeTarget = new THREE.WebGLCubeRenderTarget(512, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(1, 2000, cubeTarget);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;

  const bake = () => {
    cubeCamera.update(renderer, skyScene);
    envTarget?.dispose();
    envTarget = pmrem.fromScene(skyScene, 0.02);
    scene.environment = envTarget.texture;
  };
  bake();

  scene.background = cubeTarget.texture;
  scene.backgroundIntensity = 1.0;
  scene.environmentIntensity = 0.85;

  // Sol quente de fim de tarde + preenchimento azulado do céu.
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.6);
  sun.position.copy(SUN.direction).multiplyScalar(60);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xc4dcff, 0xf6dcb0, 0.75);
  scene.add(hemi);

  return {
    skyCube: cubeTarget.texture,
    sunLight: sun,
    /** Ajuste fino em desenvolvimento, ex.: game.env.tune({ zenith: 0x2060c0, background: 0.9 }) */
    tune(params = {}) {
      const colorKeys = { zenith: 'uZenith', mid: 'uMid', horizon: 'uHorizon', glow: 'uGlow' };
      for (const [k, v] of Object.entries(params)) {
        if (colorKeys[k]) uniforms[colorKeys[k]].value.set(v);
        if (k === 'glowStrength') uniforms.uGlowStrength.value = v;
        if (k === 'background') scene.backgroundIntensity = v;
        if (k === 'environment') scene.environmentIntensity = v;
        if (k === 'exposure') renderer.toneMappingExposure = v;
        if (k === 'sun') sun.intensity = v;
      }
      bake();
    },
  };
}
