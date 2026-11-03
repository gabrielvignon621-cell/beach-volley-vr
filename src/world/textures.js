import * as THREE from 'three';

/*
 * Texturas geradas em canvas no carregamento: nenhum arquivo de imagem é baixado.
 * Todo o ruído é periódico, então as texturas repetem sem emenda.
 */

function hash2(x, y, seed = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, period = 0, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v) => (period ? ((v % period) + period) % period : v);
  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const y0 = wrap(yi);
  const y1 = wrap(yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, { octaves = 4, period = 0, seed = 0 } = {}) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, period ? period * freq : 0, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Gerador pseudoaleatório determinístico (mesma praia a cada carregamento). */
export function seededRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function finish(texture, { srgb = true, repeat = true, anisotropy = 8 } = {}) {
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Albedo e normal map da areia, ambos tileáveis. */
export function createSandTextures(size = 512) {
  const albedo = canvas(size, size);
  const normal = canvas(size, size);
  const actx = albedo.getContext('2d');
  const nctx = normal.getContext('2d');
  const aimg = actx.createImageData(size, size);
  const nimg = nctx.createImageData(size, size);
  const height = new Float32Array(size * size);

  const light = [244, 220, 172];
  const dark = [218, 182, 128];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const macro = fbm(u * 6, v * 6, { period: 6, octaves: 4, seed: 3 });
      const grain = hash2(x, y, 9);
      const warp = fbm(u * 3, v * 3, { period: 3, octaves: 2, seed: 5 });
      // Ondulações do vento na areia (periódicas em u).
      const ripple = Math.sin(Math.PI * 2 * (7 * u + 1 * v + warp * 1.4)) * 0.5 + 0.5;

      height[y * size + x] = macro * 0.55 + ripple * 0.25 + grain * 0.2;

      const t = THREE.MathUtils.clamp(macro * 1.2 - 0.1 + (grain - 0.5) * 0.35, 0, 1);
      let r = light[0] + (dark[0] - light[0]) * t;
      let g = light[1] + (dark[1] - light[1]) * t;
      let b = light[2] + (dark[2] - light[2]) * t;
      if (grain > 0.992) { r *= 0.62; g *= 0.58; b *= 0.55; }
      else if (grain < 0.004) { r = 250; g = 246; b = 236; }

      const i = (y * size + x) * 4;
      aimg.data[i] = r;
      aimg.data[i + 1] = g;
      aimg.data[i + 2] = b;
      aimg.data[i + 3] = 255;
    }
  }

  const strength = 2.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x];
      const d = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      nimg.data[i] = (nx * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }

  actx.putImageData(aimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  return {
    map: finish(new THREE.CanvasTexture(albedo)),
    normalMap: finish(new THREE.CanvasTexture(normal), { srgb: false }),
  };
}

/**
 * Bola com o padrão clássico de 18 gomos (6 grupos de 3 faixas), em amarelo, azul e branco.
 * Desenhada em projeção equirretangular para casar com a UV de SphereGeometry.
 */
export function createVolleyballTexture(width = 1024, height = 512) {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  const Y = [255, 198, 20];
  const B = [24, 72, 178];
  const W = [246, 244, 236];
  const palette = [
    [Y, B, Y], // grupo do eixo X
    [B, W, B], // grupo do eixo Y
    [W, Y, W], // grupo do eixo Z
  ];

  for (let py = 0; py < height; py++) {
    const theta = (py / height) * Math.PI;
    for (let px = 0; px < width; px++) {
      const phi = (px / width) * Math.PI * 2;
      const dx = -Math.cos(phi) * Math.sin(theta);
      const dy = Math.cos(theta);
      const dz = Math.sin(phi) * Math.sin(theta);
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const az = Math.abs(dz);

      let axis;
      let dom;
      let t;
      let second;
      if (ax >= ay && ax >= az) { axis = 0; dom = ax; t = dy / ax; second = Math.max(ay, az); }
      else if (ay >= az) { axis = 1; dom = ay; t = dz / ay; second = Math.max(ax, az); }
      else { axis = 2; dom = az; t = dx / az; second = Math.max(ax, ay); }

      const stripe = t < -1 / 3 ? 0 : t < 1 / 3 ? 1 : 2;
      const color = palette[axis][stripe];
      const stripeSeam = Math.min(Math.abs(t + 1 / 3), Math.abs(t - 1 / 3)) * dom;
      const faceSeam = dom - second;
      const seam = Math.min(stripeSeam, faceSeam * 0.7);
      const seamShade = seam < 0.006 ? 0.5 : seam < 0.012 ? 0.82 : 1;
      const grain = 0.965 + hash2(px, py, 2) * 0.035;
      const k = seamShade * grain;

      const i = (py * width + px) * 4;
      img.data[i] = color[0] * k;
      img.data[i + 1] = color[1] * k;
      img.data[i + 2] = color[2] * k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

/** Célula da malha da rede (10 cm). Repetida pela UV, forma a malha inteira. */
export function createNetTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 5);
  ctx.fillRect(0, 0, 5, 64);
  // nós da malha
  ctx.beginPath();
  ctx.arc(2.5, 2.5, 4.5, 0, Math.PI * 2);
  ctx.fill();
  return finish(new THREE.CanvasTexture(c), { srgb: false });
}

/** Faixa superior da rede com o nome do evento. */
export function createNetBandTexture() {
  const c = canvas(2048, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d2747';
  ctx.fillRect(0, 0, 2048, 32);
  ctx.fillStyle = '#f4f6fb';
  ctx.fillRect(0, 0, 2048, 3);
  ctx.fillRect(0, 29, 2048, 3);
  ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4f6fb';
  const label = 'BEACH VOLLEY VR';
  for (let x = 40; x < 2048; x += 340) {
    ctx.fillText(label, x, 17);
    ctx.fillStyle = '#ff7a59';
    ctx.fillText('●', x + 178, 17);
    ctx.fillStyle = '#f4f6fb';
  }
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

/** Listras vermelhas e brancas das antenas (10 cm cada). */
export function createAntennaTexture() {
  const c = canvas(4, 64);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i % 2 ? '#f6f6f6' : '#e0312b';
    ctx.fillRect(0, i * 32, 4, 32);
  }
  const t = finish(new THREE.CanvasTexture(c));
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function createBlobShadowTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(new THREE.CanvasTexture(c), { srgb: false, repeat: false });
}

/** Atlas 2x2 de nuvens macias para cartões no céu. */
export function createCloudAtlas() {
  const size = 512;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rand = seededRandom(42);
  const cell = size / 2;
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const ox = cx * cell;
      const oy = cy * cell;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cell, cell);
      ctx.clip();
      const puffs = 16 + Math.floor(rand() * 10);
      for (let i = 0; i < puffs; i++) {
        const px = ox + cell * (0.18 + rand() * 0.64);
        const py = oy + cell * (0.42 + (rand() - 0.5) * 0.28 - Math.sin((px - ox) / cell * Math.PI) * 0.12);
        const r = cell * (0.08 + rand() * 0.14);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        const shade = 235 + Math.floor(rand() * 20);
        g.addColorStop(0, `rgba(${shade},${shade},${shade},0.75)`);
        g.addColorStop(0.6, `rgba(${shade},${shade},${shade},0.35)`);
        g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      }
      // base levemente acinzentada
      const base = ctx.createLinearGradient(0, oy + cell * 0.35, 0, oy + cell * 0.7);
      base.addColorStop(0, 'rgba(0,0,0,0)');
      base.addColorStop(1, 'rgba(120,128,150,0.25)');
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = base;
      ctx.fillRect(ox, oy, cell, cell);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  }
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

/** Placa de publicidade em volta da quadra. */
export function createBoardTexture() {
  const c = canvas(1024, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 1024, 0);
  g.addColorStop(0, '#0d2747');
  g.addColorStop(1, '#0f4c5c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#ff7a59';
  ctx.fillRect(0, 224, 1024, 32);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(0, 216, 1024, 8);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 92px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('BEACH VOLLEY', 52, 104);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('VR', 760, 104);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 30px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('PRAIA DO SOL  ·  CIRCUITO WEBXR', 56, 178);
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}
