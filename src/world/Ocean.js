import * as THREE from 'three';
import { SUN, WORLD } from '../config.js';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uShoreX;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vCrest;

  vec3 gerstner(vec2 dir, float wavelength, float steepness, vec3 p, inout vec3 tangent, inout vec3 binormal) {
    float k = 6.28318 / wavelength;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, p.xz) - c * uTime);
    float a = steepness / k;
    float s = sin(f);
    float co = cos(f);
    tangent += vec3(-d.x * d.x * steepness * s, d.x * steepness * co, -d.x * d.y * steepness * s);
    binormal += vec3(-d.x * d.y * steepness * s, d.y * steepness * co, -d.y * d.y * steepness * s);
    return vec3(d.x * a * co, a * s, d.y * a * co);
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    float offshore = uShoreX - p.x;
    float atten = mix(0.3, 1.0, smoothstep(0.0, 30.0, offshore));
    // Ondas curtas somem com a distância (evita cintilação/aliasing no horizonte).
    float near = 1.0 - smoothstep(50.0, 350.0, distance(p.xz, cameraPosition.xz));
    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 offset = vec3(0.0);
    // Ondas viajam para a praia (+X).
    offset += gerstner(vec2(1.0, 0.18), 21.0, 0.15 * atten, p, t, b);
    offset += gerstner(vec2(0.92, -0.38), 11.0, 0.12 * atten, p, t, b);
    offset += gerstner(vec2(1.0, 0.62), 5.6, 0.09 * atten * near, p, t, b);
    offset += gerstner(vec2(0.55, 1.0), 3.2, 0.06 * near, p, t, b);
    p += offset;
    vCrest = offset.y;
    vNormalW = normalize(cross(b, t));
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform samplerCube uEnv;
  uniform float uEnvIntensity;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uTime;
  uniform float uShoreX;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vCrest;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // Micro-ondulações: somem com a distância para não cintilar.
    float detail = 1.0 - smoothstep(20.0, 110.0, dist);
    vec2 q = vWorld.xz * 0.7 + vec2(uTime * 0.35, uTime * 0.2);
    vec2 ripple = vec2(noise(q) - 0.5, noise(q * 2.1 + 9.0) - 0.5);
    vec3 N = normalize(vNormalW + vec3(ripple.x, 0.0, ripple.y) * 0.12 * detail);

    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 reflection = textureCube(uEnv, R).rgb * uEnvIntensity;

    float offshore = uShoreX - vWorld.x;
    vec3 body = mix(uShallow, uDeep, smoothstep(2.0, 90.0, offshore));
    body *= 0.6 + 0.4 * max(dot(N, uSunDir), 0.0);
    body += vec3(0.04, 0.12, 0.10) * smoothstep(0.0, 0.32, vCrest);

    vec3 col = mix(body, reflection, fresnel);
    float sunAlign = max(dot(R, uSunDir), 0.0);
    col += uSunColor * (pow(sunAlign, 800.0) * 28.0 + pow(sunAlign, 70.0) * 0.5);

    // Espuma da arrebentação e nas cristas.
    float edge = 1.0 - smoothstep(0.0, 3.6, offshore);
    float surge = sin(offshore * 1.9 - uTime * 1.5 + noise(vWorld.xz * 0.3) * 4.0) * 0.5 + 0.5;
    float fn = noise(vWorld.xz * 1.6 + vec2(uTime * 0.25, 0.0));
    float foam = edge * smoothstep(0.35, 0.75, fn * 0.7 + surge * 0.5 + edge * 0.3);
    foam += smoothstep(0.3, 0.45, vCrest) * smoothstep(0.55, 0.85, fn) * 0.55 * detail;
    col = mix(col, vec3(1.0, 0.99, 0.96), clamp(foam, 0.0, 1.0) * 0.8);

    // Horizonte: o mar distante funde com o céu na direção do olhar.
    vec3 horizon = textureCube(uEnv, normalize(vec3(-V.x, 0.015, -V.z))).rgb * uEnvIntensity;
    col = mix(col, horizon, smoothstep(260.0, 1300.0, dist));

    float alpha = smoothstep(0.0, 1.1, offshore);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Grade do mar mais densa perto da praia, onde o jogador enxerga detalhe. */
function buildOceanGeometry(shoreX) {
  const rows = 150;
  const cols = 110;
  const reach = 1600;
  const halfSpan = 1400;
  const positions = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) {
    const x = shoreX + 3 - Math.pow(i / (rows - 1), 2.1) * reach;
    for (let j = 0; j < cols; j++) {
      const t = (j / (cols - 1)) * 2 - 1;
      const z = Math.sign(t) * Math.pow(Math.abs(t), 1.8) * halfSpan;
      const k = (i * cols + j) * 3;
      positions[k] = x;
      positions[k + 1] = 0;
      positions[k + 2] = z;
    }
  }
  const index = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + cols;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(shoreX - reach / 2, 0, 0), reach * 1.2);
  return geometry;
}

export function createOcean(scene, skyCube) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uShoreX: { value: WORLD.shorelineX },
      uEnv: { value: skyCube },
      uEnvIntensity: { value: 1.0 },
      uSunDir: { value: SUN.direction.clone() },
      uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
      uDeep: { value: new THREE.Color(0x0b5c80) },
      uShallow: { value: new THREE.Color(0x35d0c0) },
    },
  });

  const mesh = new THREE.Mesh(buildOceanGeometry(WORLD.shorelineX), material);
  mesh.position.y = WORLD.waterLevel;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh,
    update(time) {
      material.uniforms.uTime.value = time;
    },
  };
}
