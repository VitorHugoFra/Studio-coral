/**
 * Gera as ilustrações (SVG) dos pratos e banners dos restaurantes de demonstração.
 *   node scripts/gerar-ilustracoes.js
 * Saída: public/demo-assets/*.svg
 * Os restaurantes reais usam as fotos enviadas pelo painel.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'demo-assets');
fs.mkdirSync(OUT, { recursive: true });

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const r = (a, b) => a + rnd() * (b - a);
const f = (n) => n.toFixed(1);

// ── Fundos ─────────────────────────────────────────────────
function wood(w, h, base = '#6b3f1f') {
  let s = `<rect width="${w}" height="${h}" fill="${base}"/>`;
  for (let i = 0; i < h; i += r(14, 30)) {
    s += `<path d="M0 ${f(i)} C ${f(w * 0.3)} ${f(i + r(-6, 6))}, ${f(w * 0.6)} ${f(i + r(-8, 8))}, ${w} ${f(i + r(-5, 5))}" stroke="#000" stroke-opacity="${f(r(0.05, 0.14))}" stroke-width="${f(r(1, 3))}" fill="none"/>`;
  }
  for (let i = 0; i < 6; i += 1) s += `<ellipse cx="${f(r(0, w))}" cy="${f(r(0, h))}" rx="${f(r(10, 26))}" ry="${f(r(4, 8))}" fill="#000" opacity=".08"/>`;
  return s;
}
function linen(w, h, base = '#efe6d6') {
  let s = `<rect width="${w}" height="${h}" fill="${base}"/>`;
  for (let i = 0; i < w; i += 6) s += `<line x1="${i}" y1="0" x2="${i}" y2="${h}" stroke="#000" stroke-opacity=".025"/>`;
  for (let i = 0; i < h; i += 6) s += `<line x1="0" y1="${i}" x2="${w}" y2="${i}" stroke="#000" stroke-opacity=".025"/>`;
  return s;
}
const shadow = (cx, cy, rr) => `<circle cx="${cx + 10}" cy="${cy + 14}" r="${rr}" fill="#000" opacity=".22"/>`;
const plate = (cx, cy, rr, rim = '#f6f1e8', inner = '#fffdf8') => `${shadow(cx, cy, rr)}<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${rim}"/><circle cx="${cx}" cy="${cy}" r="${rr * 0.78}" fill="${inner}"/><circle cx="${cx}" cy="${cy}" r="${rr * 0.78}" fill="none" stroke="#000" stroke-opacity=".05" stroke-width="3"/>`;
const leaf = (x, y, s = 1, rot = 0, c = '#2f6a1f') => `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${s})" d="M0 0 C 10 -14, 30 -14, 40 0 C 30 14, 10 14, 0 0 Z" fill="${c}"/><path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${s})" d="M2 0 L 36 0" stroke="#1d4a12" stroke-width="1.2"/>`;

// ── Comidas (desenhadas em torno de cx, cy) ────────────────
function swirl(cx, cy, rr, colors, strands = 70) {
  let s = '';
  for (let i = 0; i < strands; i += 1) {
    const a = r(0, Math.PI * 2); const rad = r(rr * 0.15, rr);
    const x = cx + Math.cos(a) * rad * 0.5; const y = cy + Math.sin(a) * rad * 0.5;
    const len = r(rr * 0.5, rr * 1.1); const a2 = a + r(1.2, 2.4);
    s += `<path d="M${f(x)} ${f(y)} q ${f(Math.cos(a2) * len)} ${f(Math.sin(a2) * len)} ${f(Math.cos(a2 + 1) * len * 0.8)} ${f(Math.sin(a2 + 1) * len * 0.8)}" stroke="${colors[i % colors.length]}" stroke-width="${f(r(5, 8))}" fill="none" stroke-linecap="round"/>`;
  }
  return s;
}
const dots = (cx, cy, rr, n, color, size = [3, 6]) => Array.from({ length: n }, () => {
  const a = r(0, Math.PI * 2); const d = Math.sqrt(rnd()) * rr;
  return `<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(r(size[0], size[1]))}" fill="${color}"/>`;
}).join('');
const blobs = (cx, cy, rr, n, color, size = [10, 18], ry = 0.7) => Array.from({ length: n }, () => {
  const a = r(0, Math.PI * 2); const d = Math.sqrt(rnd()) * rr; const sz = r(size[0], size[1]);
  return `<ellipse cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" rx="${f(sz)}" ry="${f(sz * ry)}" transform="rotate(${f(r(0, 180))} ${f(cx + Math.cos(a) * d)} ${f(cy + Math.sin(a) * d)})" fill="${color}"/>`;
}).join('');

const DISHES = {
  lasanha: (cx, cy, s) => `${plate(cx, cy, 200 * s)}<rect x="${cx - 95 * s}" y="${cy - 75 * s}" width="${190 * s}" height="${150 * s}" rx="${14 * s}" fill="#c9481f"/><rect x="${cx - 95 * s}" y="${cy - 75 * s}" width="${190 * s}" height="${150 * s}" rx="${14 * s}" fill="url(#gratin)"/>${dots(cx, cy, 70 * s, 40, '#8c3a12', [4 * s, 9 * s])}${dots(cx, cy, 70 * s, 26, '#f1c75b', [3 * s, 7 * s])}${leaf(cx + 20 * s, cy - 20 * s, s, -30)}${leaf(cx - 30 * s, cy + 10 * s, s * 0.8, 140)}`,
  funghi: (cx, cy, s) => `${plate(cx, cy, 200 * s)}<circle cx="${cx}" cy="${cy}" r="${120 * s}" fill="#f0dfb8"/>${swirl(cx, cy, 120 * s, ['#f4e2b4', '#e8cf95', '#f8ecc9'], 90)}${blobs(cx, cy, 80 * s, 12, '#8a5a32', [12 * s, 20 * s], 0.55)}${blobs(cx, cy, 80 * s, 8, '#6d4424', [8 * s, 14 * s], 0.5)}${dots(cx, cy, 90 * s, 30, '#3d6b2a', [2 * s, 3.5 * s])}`,
  nhoque: (cx, cy, s) => `${plate(cx, cy, 200 * s)}<circle cx="${cx}" cy="${cy}" r="${115 * s}" fill="#f1d27a" opacity=".55"/>${blobs(cx, cy, 95 * s, 34, '#f0b85a', [16 * s, 22 * s], 0.72)}${blobs(cx, cy, 95 * s, 14, '#f6cd78', [14 * s, 18 * s], 0.7)}${leaf(cx - 40 * s, cy - 30 * s, s * 0.9, 20, '#5b7b3a')}${leaf(cx + 30 * s, cy + 40 * s, s * 0.9, 200, '#5b7b3a')}${leaf(cx + 10 * s, cy - 60 * s, s * 0.8, 100, '#5b7b3a')}`,
  carbonara: (cx, cy, s) => `${plate(cx, cy, 200 * s)}<circle cx="${cx}" cy="${cy}" r="${120 * s}" fill="#f2d68a"/>${swirl(cx, cy, 120 * s, ['#f5d985', '#ecc86a', '#f9e4a1'], 100)}${blobs(cx, cy, 85 * s, 14, '#c9715a', [8 * s, 13 * s], 0.6)}${dots(cx, cy, 100 * s, 60, '#2b2118', [1.2 * s, 2.4 * s])}<circle cx="${cx + 10 * s}" cy="${cy - 5 * s}" r="${22 * s}" fill="#f29b1d"/><circle cx="${cx + 4 * s}" cy="${cy - 11 * s}" r="${6 * s}" fill="#ffd27a"/>`,
  bruschetta: (cx, cy, s) => `<rect x="${cx - 180 * s}" y="${cy - 116 * s}" width="${380 * s}" height="${260 * s}" rx="${24 * s}" fill="#000" opacity=".22"/><rect x="${cx - 190 * s}" y="${cy - 130 * s}" width="${380 * s}" height="${260 * s}" rx="${24 * s}" fill="#b98953"/><rect x="${cx - 190 * s}" y="${cy - 130 * s}" width="${380 * s}" height="${260 * s}" rx="${24 * s}" fill="none" stroke="#8d6236" stroke-width="${6 * s}"/>${[-110, 0, 110].map((dx) => `<ellipse cx="${cx + dx * s}" cy="${cy}" rx="${52 * s}" ry="${92 * s}" fill="#d9a25c"/><ellipse cx="${cx + dx * s}" cy="${cy}" rx="${44 * s}" ry="${82 * s}" fill="#f1cf8c"/>${blobs(cx + dx * s, cy, 55 * s, 9, '#d4331f', [9 * s, 13 * s], 0.9)}<circle cx="${cx + dx * s}" cy="${cy + 10 * s}" r="${20 * s}" fill="#fbf6ec"/>${dots(cx + dx * s, cy, 50 * s, 6, '#3f7d2b', [3 * s, 5 * s])}`).join('')}`,
  tiramisu: (cx, cy, s) => `${plate(cx, cy, 170 * s)}<rect x="${cx - 85 * s}" y="${cy - 85 * s}" width="${170 * s}" height="${170 * s}" rx="${10 * s}" fill="#6b4126"/><rect x="${cx - 85 * s}" y="${cy - 85 * s}" width="${170 * s}" height="${170 * s}" rx="${10 * s}" fill="url(#cocoa)"/>${dots(cx, cy, 70 * s, 70, '#4a2a14', [1.5 * s, 3 * s])}<ellipse cx="${cx + 40 * s}" cy="${cy - 40 * s}" rx="${10 * s}" ry="${14 * s}" fill="#3a2010"/><ellipse cx="${cx + 55 * s}" cy="${cy - 25 * s}" rx="${10 * s}" ry="${14 * s}" fill="#3a2010"/>${leaf(cx - 50 * s, cy + 40 * s, s * 0.8, -40, '#3f7d2b')}`,
  vinho: (cx, cy, s) => `${shadow(cx, cy, 120 * s)}<circle cx="${cx}" cy="${cy}" r="${120 * s}" fill="#ffffff" opacity=".55"/><circle cx="${cx}" cy="${cy}" r="${112 * s}" fill="none" stroke="#fff" stroke-width="${4 * s}"/><circle cx="${cx}" cy="${cy}" r="${88 * s}" fill="#6e0f1f"/><circle cx="${cx}" cy="${cy}" r="${88 * s}" fill="url(#wine)"/><ellipse cx="${cx - 35 * s}" cy="${cy - 40 * s}" rx="${22 * s}" ry="${10 * s}" fill="#fff" opacity=".35" transform="rotate(-35 ${cx - 35 * s} ${cy - 40 * s})"/>${shadow(cx + 150 * s, cy + 110 * s, 34 * s)}<circle cx="${cx + 150 * s}" cy="${cy + 110 * s}" r="${34 * s}" fill="#c9a36a"/><circle cx="${cx + 150 * s}" cy="${cy + 110 * s}" r="${26 * s}" fill="#b08a52"/>`,
  tropeiro: (cx, cy, s) => tray(cx, cy, s, [
    (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#a8743c"/>${dots(x + w / 2, y + h / 2, Math.min(w, h) / 2, 90, '#5a3518', [2 * s, 5 * s])}${dots(x + w / 2, y + h / 2, Math.min(w, h) / 2, 40, '#d6a35c', [2 * s, 4 * s])}`,
    (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fbf7ee"/>${dots(x + w / 2, y + h / 2, Math.min(w, h) / 2.2, 70, '#efe6d2', [3 * s, 5 * s])}<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${38 * s}" fill="#fff"/><circle cx="${x + w / 2 + 4 * s}" cy="${y + h / 2 - 3 * s}" r="${15 * s}" fill="#f5a623"/>`,
    (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2f6a1f"/>${Array.from({ length: 16 }, () => `<path d="M${f(x + r(0, w))} ${f(y + r(0, h))} l ${f(r(10, 30) * s)} ${f(r(-6, 6) * s)}" stroke="#4f9a35" stroke-width="${3 * s}"/>`).join('')}${blobs(x + w / 2, y + h / 2, Math.min(w, h) / 3, 6, '#d9963a', [9 * s, 12 * s], 0.8)}`,
  ]),
  frango: (cx, cy, s) => `${plate(cx, cy, 200 * s)}<path d="M${cx - 120 * s} ${cy} A ${120 * s} ${120 * s} 0 0 1 ${cx} ${cy - 120 * s} L ${cx} ${cy} Z" fill="#fbf7ee"/>${dots(cx - 50 * s, cy - 50 * s, 45 * s, 40, '#efe6d2', [3 * s, 5 * s])}<path d="M${cx} ${cy - 120 * s} A ${120 * s} ${120 * s} 0 0 1 ${cx + 120 * s} ${cy} L ${cx} ${cy} Z" fill="#f3c74a"/>${blobs(cx, cy + 45 * s, 70 * s, 7, '#b5651d', [22 * s, 30 * s], 0.7)}${blobs(cx, cy + 45 * s, 70 * s, 5, '#d58a35', [12 * s, 18 * s], 0.7)}${Array.from({ length: 9 }, () => { const x = cx + r(-70, 70) * s; const y = cy + r(10, 90) * s; return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(9 * s)}" fill="#5f9a3a"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(4 * s)}" fill="#c7e09a"/>`; }).join('')}`,
  fitness: (cx, cy, s) => tray(cx, cy, s, [
    (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e7d6b8"/>${Array.from({ length: 4 }, (_, i) => `<rect x="${x + 14 * s + i * (w - 28 * s) / 4}" y="${y + 18 * s}" width="${(w - 40 * s) / 4}" height="${h - 36 * s}" rx="${8 * s}" fill="#d9a35f"/>${Array.from({ length: 4 }, (__, j) => `<line x1="${x + 18 * s + i * (w - 28 * s) / 4}" y1="${y + 30 * s + j * 22 * s}" x2="${x + 10 * s + (i + 1) * (w - 28 * s) / 4}" y2="${y + 22 * s + j * 22 * s}" stroke="#7a4a1d" stroke-width="${4 * s}"/>`).join('')}`).join('')}`,
    (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c9a77c"/>${dots(x + w / 2, y + h / 2, Math.min(w, h) / 2.2, 80, '#a7835a', [2.5 * s, 4 * s])}`,
    (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f4efe4"/>${blobs(x + w / 2, y + h / 2, Math.min(w, h) / 3, 7, '#3f8a2a', [14 * s, 18 * s], 0.95)}${blobs(x + w / 2, y + h / 2, Math.min(w, h) / 3, 6, '#ef8a2b', [7 * s, 14 * s], 0.45)}`,
  ]),
  paodequeijo: (cx, cy, s) => `${shadow(cx, cy, 190 * s)}<circle cx="${cx}" cy="${cy}" r="${190 * s}" fill="#9c6b36"/>${Array.from({ length: 10 }, (_, i) => `<circle cx="${cx}" cy="${cy}" r="${(190 - i * 6) * s}" fill="none" stroke="${i % 2 ? '#7f5326' : '#b8844a'}" stroke-width="${3 * s}"/>`).join('')}<circle cx="${cx}" cy="${cy}" r="${135 * s}" fill="#f4ead6"/>${Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; const d = i % 3 === 0 ? 30 : 80; const x = cx + Math.cos(a) * d * s; const y = cy + Math.sin(a) * d * s; return `<circle cx="${f(x + 4 * s)}" cy="${f(y + 6 * s)}" r="${34 * s}" fill="#000" opacity=".15"/><circle cx="${f(x)}" cy="${f(y)}" r="${34 * s}" fill="#e7b04f"/><circle cx="${f(x - 8 * s)}" cy="${f(y - 10 * s)}" r="${14 * s}" fill="#f6d488"/>`; }).join('')}`,
  docedeleite: (cx, cy, s) => `${plate(cx, cy, 160 * s)}<circle cx="${cx - 20 * s}" cy="${cy + 5 * s}" r="${80 * s}" fill="#a65d1c"/><circle cx="${cx - 20 * s}" cy="${cy + 5 * s}" r="${80 * s}" fill="url(#caramel)"/><path d="M${cx - 60 * s} ${cy} q ${40 * s} ${-30 * s} ${80 * s} 0" stroke="#d68a3c" stroke-width="${8 * s}" fill="none" stroke-linecap="round"/><rect x="${cx + 30 * s}" y="${cy - 60 * s}" width="${80 * s}" height="${80 * s}" rx="${8 * s}" fill="#fbf6e6"/><rect x="${cx + 30 * s}" y="${cy - 60 * s}" width="${80 * s}" height="${80 * s}" rx="${8 * s}" fill="none" stroke="#e8dcb8" stroke-width="${4 * s}"/>`,
  suco: (cx, cy, s) => `${shadow(cx, cy, 110 * s)}<circle cx="${cx}" cy="${cy}" r="${110 * s}" fill="#fff" opacity=".6"/><circle cx="${cx}" cy="${cy}" r="${94 * s}" fill="#f7931e"/><circle cx="${cx}" cy="${cy}" r="${94 * s}" fill="url(#juice)"/>${dots(cx, cy, 70 * s, 18, '#ffb347', [3 * s, 6 * s])}<circle cx="${cx + 80 * s}" cy="${cy - 70 * s}" r="${44 * s}" fill="#f7a21b"/><circle cx="${cx + 80 * s}" cy="${cy - 70 * s}" r="${36 * s}" fill="#ffd27a"/>${Array.from({ length: 8 }, (_, i) => `<line x1="${cx + 80 * s}" y1="${cy - 70 * s}" x2="${f(cx + 80 * s + Math.cos(i * Math.PI / 4) * 34 * s)}" y2="${f(cy - 70 * s + Math.sin(i * Math.PI / 4) * 34 * s)}" stroke="#f7a21b" stroke-width="${2 * s}"/>`).join('')}<line x1="${cx - 20 * s}" y1="${cy + 10 * s}" x2="${cx - 140 * s}" y2="${cy + 150 * s}" stroke="#ffffff" stroke-width="${10 * s}" stroke-linecap="round"/><line x1="${cx - 20 * s}" y1="${cy + 10 * s}" x2="${cx - 140 * s}" y2="${cy + 150 * s}" stroke="#d93a2b" stroke-width="${10 * s}" stroke-dasharray="${12 * s} ${12 * s}" stroke-linecap="round"/>`,
};

function tray(cx, cy, s, parts) {
  const W = 360 * s; const H = 280 * s; const x0 = cx - W / 2; const y0 = cy - H / 2; const p = 12 * s;
  const left = (W - 3 * p) * 0.55; const right = W - 3 * p - left; const half = (H - 3 * p) / 2;
  return `<rect x="${x0 + 10}" y="${y0 + 14}" width="${W}" height="${H}" rx="${18 * s}" fill="#000" opacity=".22"/><rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="${18 * s}" fill="#d9dde0"/><rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="${18 * s}" fill="none" stroke="#b9bfc4" stroke-width="${5 * s}"/>
    <g>${parts[0](x0 + p, y0 + p, left, H - 2 * p)}</g><g>${parts[1](x0 + 2 * p + left, y0 + p, right, half)}</g><g>${parts[2](x0 + 2 * p + left, y0 + 2 * p + half, right, half)}</g>`;
}

const DEFS = `<defs>
  <radialGradient id="gratin" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#e86a2a" stop-opacity="0"/><stop offset="1" stop-color="#7a2c0c" stop-opacity=".6"/></radialGradient>
  <radialGradient id="cocoa" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#8b5a37" stop-opacity=".2"/><stop offset="1" stop-color="#2d170a" stop-opacity=".5"/></radialGradient>
  <radialGradient id="wine" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#b3263e" stop-opacity=".5"/><stop offset="1" stop-color="#2a0309" stop-opacity=".7"/></radialGradient>
  <radialGradient id="caramel" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#e09a4a" stop-opacity=".6"/><stop offset="1" stop-color="#5c2c08" stop-opacity=".5"/></radialGradient>
  <radialGradient id="juice" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#ffd27a" stop-opacity=".6"/><stop offset="1" stop-color="#c25e0a" stop-opacity=".4"/></radialGradient>
  <radialGradient id="vignette" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
</defs>`;

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${DEFS}${body}<rect width="${w}" height="${h}" fill="url(#vignette)"/></svg>`;

const ITEMS = {
  // Cantina Bella Nonna (mesa de madeira escura)
  'nonna-lasanha': ['lasanha', 'wood', '#5a3218'],
  'nonna-funghi': ['funghi', 'wood', '#5a3218'],
  'nonna-nhoque': ['nhoque', 'wood', '#5a3218'],
  'nonna-carbonara': ['carbonara', 'wood', '#5a3218'],
  'nonna-bruschetta': ['bruschetta', 'wood', '#4a2a14'],
  'nonna-tiramisu': ['tiramisu', 'wood', '#5a3218'],
  'nonna-vinho': ['vinho', 'wood', '#4a2a14'],
  // Sabor de Minas (madeira clara / toalha)
  'minas-tropeiro': ['tropeiro', 'wood', '#8a5a2e'],
  'minas-frango': ['frango', 'wood', '#8a5a2e'],
  'minas-fitness': ['fitness', 'linen', '#e9e1d0'],
  'minas-paodequeijo': ['paodequeijo', 'linen', '#d8cbb0'],
  'minas-docedeleite': ['docedeleite', 'wood', '#8a5a2e'],
  'minas-suco': ['suco', 'linen', '#e9e1d0'],
};

for (const [name, [dish, bg, color]] of Object.entries(ITEMS)) {
  const back = bg === 'wood' ? wood(600, 600, color) : linen(600, 600, color);
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg(600, 600, back + DISHES[dish](300, 300, 1.58)));
}

// Banners (1200x520): mesa posta com pratos do cardápio
function banner(name, bgColor, dishes) {
  let body = wood(1200, 520, bgColor);
  body += dishes.map(([d, x, y, s]) => DISHES[d](x, y, s)).join('');
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg(1200, 520, body));
}
banner('nonna-banner-1', '#5a3218', [['lasanha', 240, 270, 1.05], ['bruschetta', 640, 150, 0.8], ['vinho', 980, 330, 0.9], ['carbonara', 700, 430, 0.75]]);
banner('nonna-banner-2', '#4a2a14', [['nhoque', 300, 220, 1.0], ['funghi', 760, 300, 1.05], ['tiramisu', 1080, 120, 0.7]]);
banner('minas-banner-1', '#8a5a2e', [['tropeiro', 300, 260, 1.05], ['paodequeijo', 760, 220, 0.85], ['suco', 1050, 380, 0.75]]);
banner('minas-banner-2', '#7a4c24', [['frango', 330, 260, 1.05], ['docedeleite', 760, 330, 0.9], ['fitness', 1030, 170, 0.6]]);

console.log(`Ilustrações geradas em ${OUT}`);
