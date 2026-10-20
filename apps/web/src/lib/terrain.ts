/* Relieve procedural suave (tema claro) para el mapa base sin red. Es decorativo:
 * no representa la topografía real. Se genera una vez como imagen. */
export interface TerrainImage { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] }

export function makeTerrain(bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }, margin = 0.8, S = 640): TerrainImage {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!, img = g.createImageData(S, S), px = img.data;
  let a = 7; const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const P = 256, perm = new Float32Array(P * P); for (let i = 0; i < perm.length; i++) perm[i] = rnd();
  const vn = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const p00 = perm[(yi & 255) * P + (xi & 255)], p10 = perm[(yi & 255) * P + ((xi + 1) & 255)], p01 = perm[((yi + 1) & 255) * P + (xi & 255)], p11 = perm[((yi + 1) & 255) * P + ((xi + 1) & 255)];
    return p00 + (p10 - p00) * u + (p01 - p00) * v + (p00 - p10 - p01 + p11) * u * v;
  };
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = x / S, ny = y / S; let f = 0, amp = 0.5, fr = 5;
    for (let o = 0; o < 5; o++) { f += vn(nx * fr, ny * fr) * amp; amp *= 0.5; fr *= 2.03; }
    const r1 = Math.exp(-Math.pow((nx * 0.9 + ny * 0.25 - 0.45) * 5.2, 2)), r2 = Math.exp(-Math.pow((nx * 0.7 - ny * 0.35 - 0.36) * 5.5, 2)) * 0.6;
    H[y * S + x] = f * 0.62 + (r1 + r2) * 0.45 * (0.5 + f);
  }
  const L = 16;
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x, h = H[i], sh = (H[i - S - 1] - H[i + S + 1]) * 9, lv = Math.floor(h * L);
    const edge = lv !== Math.floor(H[i + 1] * L) || lv !== Math.floor(H[i + S] * L), t = Math.min(1, Math.max(0, h));
    // papel claro con sombreado y curvas de nivel tenues
    let r = 242 - t * 14 + sh * 26, gg = 241 - t * 10 + sh * 26, b = 236 - t * 14 + sh * 24;
    if (edge) { r -= 10; gg -= 9; b -= 6; }
    const o = i * 4; px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const w = bbox.lonMin - margin, e = bbox.lonMax + margin, n = bbox.latMax + margin, s = bbox.latMin - margin;
  return { url: c.toDataURL('image/png'), coordinates: [[w, n], [e, n], [e, s], [w, s]] };
}
