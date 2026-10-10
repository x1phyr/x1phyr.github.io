// 无边 · 寒江独钓 —— 纯 Canvas 2D 水墨。宣纸（离屏缓存）＋ 一叶舟（离屏缓存）＋ 钓丝、水纹、疏雪（逐帧）。
// 笔法改自 huashu「91_hanjiang_min」：湿笔 ribbon（洇边＋湿芯＋笔毛飞白）。
// 坐标：舟的「局部单位」u（船长约 400u）；屏幕 = 锚点 + (世界x − 镜头x)·S。
(() => {
'use strict';

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const HAS_FILTER = typeof ctx.filter === 'string';
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = mq.matches;

// ---------- 工具 ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = p => 1 - Math.pow(1 - p, 3);
const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };

const perm = new Uint8Array(512);
{ const r = rng(1337), p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h, x, y) => { const u = (h & 1) ? x : -x, v = (h & 2) ? y : -y; return (h & 4) ? u + v * 0.5 : u * 0.5 + v; };
const noise = (x, y) => {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
  return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
};
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2; } return s; };

// Catmull-Rom 加密 → 等弧长重采样 → 可变宽 ribbon
const densify = (pts, per = 5) => {
  const out = [], n = pts.length, P_ = i => pts[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P_(i - 1), p1 = P_(i), p2 = P_(i + 1), p3 = P_(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  out.push(pts[n - 1]); return out;
};
const resample = (pts, step = 4) => {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let d = step - acc;
    while (d <= L) { const q = d / L; out.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]); d += step; } acc = L - (d - step); }
  out.push(pts[pts.length - 1]); return out;
};
const ribbon = (pts, w) => {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const hw = w(i / Math.max(1, n - 1), i) / 2;
    L.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]); R.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
  }
  const p = new Path2D(); L.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]));
  for (let i = n - 1; i >= 0; i--) p.lineTo(R[i][0], R[i][1]); p.closePath(); return p;
};
const normals = (D) => D.map((_, i) => { const A = D[Math.max(0, i - 1)], B = D[Math.min(D.length - 1, i + 1)], dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1; return [-dy / d, dx / d]; });

// 毛笔（屏幕层：水纹、尾迹）：笔压起收＋湿芯＋笔毛飞白
function brush(c, pts, { w = 10, tone = 0.85, dry = 0.45, seed = 1, bristles = 6, head = 0.12, tail = 0.4, step = 4 } = {}) {
  const D = resample(densify(pts, 5), step), n = D.length; if (n < 2) return;
  const r = rng(seed * 7919), N = normals(D);
  const prof = q => ss(0, head, q) * (1 - 0.7 * ss(1 - tail, 1, q)) * (0.85 + 0.15 * noise(seed * 3.3, q * 6)) + 0.08;
  c.lineCap = 'butt'; c.lineJoin = 'round';
  c.fillStyle = `rgba(16,14,12,${tone * 0.72})`;
  c.fill(ribbon(D, q => w * prof(q) * (1 - dry * 0.85 * Math.pow(q, 0.8))));
  for (let k = 0; k < bristles; k++) {
    const off = (k / (bristles - 1) - 0.5) * 0.95, bw = w / bristles * (0.9 + r() * 0.9), ph = r() * 50;
    c.strokeStyle = `rgba(16,14,12,${tone * (0.45 + r() * 0.35)})`; c.lineWidth = Math.max(0.6, bw);
    c.beginPath(); let on = false;
    for (let i = 0; i < n; i++) {
      const q = i / (n - 1), vis = noise(k * 1.9 + ph, i * 0.09) * 0.5 + 0.5 > dry * Math.pow(q, 1.2) * 0.95 + 0.05;
      const o = off * w * prof(q), x = D[i][0] + N[i][0] * o, y = D[i][1] + N[i][1] * o;
      if (vis) { on ? c.lineTo(x, y) : c.moveTo(x, y); on = true; } else on = false;
    }
    c.stroke();
  }
}

// 湿笔（舟、渔翁、钓竿；只在缓存时画）。BK = 当前缓存画布的像素/单位，用来换算模糊半径。
let BK = 1;
function wet(g, pts, { w = 10, tone = 0.85, prof = q => Math.sin(Math.PI * q), seed = 1, bleed = 2, dry = 0.5, dryFrom = 0.45, bristles = 9 } = {}) {
  const D = resample(densify(pts, 5), 3), n = D.length, r = rng(seed * 131);
  const wq = i => Math.max(0.6, w * prof(i / (n - 1)) * (0.88 + 0.12 * noise(seed * 3.1, i * 0.05) + 0.08 * noise(seed * 7.7, i * 0.6)));
  g.save();
  if (bleed > 0 && HAS_FILTER) { g.fillStyle = `rgba(16,14,12,${tone * 0.4})`; g.filter = `blur(${(bleed * BK).toFixed(2)}px)`; g.fill(ribbon(D, (q, i) => wq(i) * 1.05)); g.filter = 'none'; }
  g.fillStyle = `rgba(16,14,12,${tone * 0.8})`; g.fill(ribbon(D, (q, i) => wq(i) * (0.72 - 0.4 * dry * ss(dryFrom, 1, i / (n - 1)))));
  if (bristles > 0) {
    const N = normals(D); g.lineCap = 'butt'; g.lineJoin = 'round';
    for (let k = 0; k < bristles; k++) {
      const off = (k / (bristles - 1) - 0.5) * 0.92 + (r() - 0.5) * 0.06, ph = r() * 50, edge = Math.abs(off) * 2;
      g.strokeStyle = `rgba(16,14,12,${tone * (0.55 + r() * 0.4)})`; g.lineWidth = Math.max(0.8, w / bristles * (1 + r() * 0.9)); g.beginPath(); let on = false;
      for (let i = 0; i < n; i++) { const q = i / (n - 1), dq = dry * ss(dryFrom, 1, q) + edge * 0.18;
        const vis = noise(k * 1.9 + ph, i * 0.09) * 0.5 + 0.5 > dq * 0.95 + 0.04;
        const o = off * wq(i), x = D[i][0] + N[i][0] * o, y = D[i][1] + N[i][1] * o;
        if (vis) { on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; } else on = false; }
      g.stroke();
    }
  }
  g.restore();
}
const swell = (a, b) => q => Math.pow(ss(0, a, q), 0.7) * (1 - 0.9 * ss(b, 1, q)) + 0.05;

// ---------- 舟＋渔翁＋钓竿（局部坐标：原点＝吃水线中点，面朝右） ----------
const BOX = { x0: -236, y0: -196, x1: 372, y1: 52 };
const ROD_TIP = [336, -164];
const WATER = 30;            // 水面（钓丝入水、水纹所在）的局部 y
function drawBoat(g) {
  // 渔翁（放大 1.25，绕船面 x=30）
  g.save(); g.translate(30, 0); g.scale(1.25, 1.25); g.translate(-30, 0);
  wet(g, [[20, -58], [34, -36], [42, -6]], { w: 70, tone: 0.3, prof: q => 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, q * 1.1)), seed: 20, bleed: 6, dry: 0.5, dryFrom: 0.5, bristles: 14 });
  wet(g, [[-2, -2], [-6, -28], [8, -52], [30, -64], [50, -62]], { w: 30, tone: 0.9, prof: q => (1 - 0.75 * ss(0.35, 1, q)) * Math.pow(ss(0, 0.12, q), 0.6) + 0.06, seed: 21, bleed: 2.5, dry: 0.75, dryFrom: 0.1, bristles: 10 });
  wet(g, [[56, -54], [74, -38], [86, -20], [90, -2]], { w: 18, tone: 0.7, prof: swell(0.2, 0.55), seed: 22, bleed: 3, dry: 0.7, dryFrom: 0.3, bristles: 8 });
  wet(g, [[22, -50], [26, -26], [32, -4]], { w: 9, tone: 0.5, prof: swell(0.2, 0.5), seed: 23, bleed: 2, dry: 0.8, dryFrom: 0.1, bristles: 5 });
  wet(g, [[70, -44], [84, -39], [96, -36]], { w: 5, tone: 0.8, prof: swell(0.4, 0.5), seed: 24, bleed: 1, dry: 0.3, bristles: 3 });
  // 斗笠：一个墨块，笠沿最重，顺笠势刮出飞白
  g.save(); g.translate(63, -61); g.rotate(0.14);
  const hp = [];
  const edge = (x0, y0, x1, y1, cx, cy, N, sd) => { for (let i = 0; i < N; i++) { const q = i / N, a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c2 = q * q; hp.push([a * x0 + b * cx + c2 * x1 + noise(sd, q * 9) * 1.6, a * y0 + b * cy + c2 * y1 + noise(sd + 5, q * 9) * 1.6]); } };
  edge(-52, 5, -1, -25, -18, -13, 14, 1); edge(-1, -25, 52, 3, 16, -13, 14, 2); edge(52, 3, -52, 5, 0, 14, 18, 3);
  const hat = new Path2D(); hp.forEach((p, i) => i ? hat.lineTo(p[0], p[1]) : hat.moveTo(p[0], p[1])); hat.closePath();
  g.fillStyle = '#fff'; g.fill(hat);                                   // 白＝multiply 下的纸色，蓑衣不透过斗笠
  if (HAS_FILTER) { g.filter = `blur(${(2 * BK).toFixed(2)}px)`; g.fillStyle = 'rgba(16,14,12,.5)'; g.fill(hat); g.filter = 'none'; }
  const gr = g.createLinearGradient(0, -25, 0, 10); gr.addColorStop(0, 'rgba(16,14,12,.78)'); gr.addColorStop(0.75, 'rgba(16,14,12,.92)'); gr.addColorStop(1, 'rgba(16,14,12,.95)');
  g.fillStyle = gr; g.fill(hat);
  g.globalCompositeOperation = 'destination-out';
  brush(g, [[-8, -17], [-22, -7], [-36, -1]], { w: 5, tone: 0.4, dry: 0.95, seed: 41, bristles: 3, head: 0.05, tail: 0.6, step: 3 });
  g.restore();
  g.restore();
  // 船身一层极淡的墨
  const hull = new Path2D(); hull.moveTo(-200, -24); hull.bezierCurveTo(-120, 0, 60, 4, 196, -30); hull.bezierCurveTo(150, 4, 60, 18, -40, 16); hull.bezierCurveTo(-130, 14, -170, 0, -200, -24); hull.closePath();
  g.save(); if (HAS_FILTER) g.filter = `blur(${(3 * BK).toFixed(2)}px)`; g.fillStyle = 'rgba(30,28,26,.16)'; g.fill(hull); g.restore();
  // 船腹一笔：船尾起笔细、船腹最粗、到船头收细上挑
  wet(g, [[-204, -28], [-160, 2], [-60, 16], [60, 14], [150, 2], [198, -32]], { w: 17, tone: 0.86, prof: q => Math.pow(ss(0, 0.32, q), 0.8) * (1 - 0.92 * ss(0.55, 1, q)) + 0.06, seed: 11, dry: 0.75, dryFrom: 0.45, bristles: 10 });
  // 船舷一笔细线，两头略重
  wet(g, [[-198, -26], [-110, -6], [0, -1], [110, -5], [194, -30]], { w: 4.2, tone: 0.8, prof: q => 0.45 + 0.55 * Math.pow(Math.abs(q - 0.5) * 2, 2), seed: 12, bleed: 1.2, dry: 0.45, dryFrom: 0.3, bristles: 3 });
  // 钓竿一笔，粗细渐收
  wet(g, [[62, -38], [108, -45], [196, -96], [272, -136], ROD_TIP], { w: 3.8, tone: 0.9, prof: q => 1 - 0.85 * q, seed: 31, bleed: 0.8, dry: 0.15, dryFrom: 0.6, bristles: 2 });
}

// ---------- 状态 ----------
let VW = 0, VH = 0, DPR = 1, S = 1, AX = 0, AY = 0, PORTRAIT = false;
let paper = null, boat = null, flakeImg = null, flakes = [];
const st = {
  t: 0, bx: 0, vx: 0, camX: 0, camV: 0, pitch: 0, pitchV: 0,
  hookX: ROD_TIP[0] + 16, nextRing: 0.6, idle: 0, lastStroke: -9,
  moved: false, poemAt: 16, poemOn: false, poemIdx: 0,
};
const rings = [], trails = [];
const keys = { fwd: false, left: false, right: false };

// ---------- 宣纸（离屏，一次） ----------
function buildPaper() {
  const w = Math.round(VW * DPR), h = Math.round(VH * DPR), c = mk(w, h), g = c.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#e9e1ca'; g.fillRect(0, 0, VW, VH);
  // 低频斑驳＋冷灰淡墨（上重下轻，舟周留白），低分辨率生成后平滑放大
  const sw = 200, sh = Math.max(60, Math.round(200 * VH / VW)), s = mk(sw, sh), sg = s.getContext('2d'), im = sg.createImageData(sw, sh), d = im.data;
  const asp = VW / VH;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const X = x / sw, Y = y / sh, n = fbm(X * 4.2 * Math.min(asp, 2) + 11, Y * 4.2 + 3, 5), m = fbm(X * 2.6 + 7, Y * 2.6 + 2, 5);
    const i = (y * sw + x) * 4;
    const top = 0.1 * Math.pow(1 - Y, 1.8), bot = 0.05 * Math.pow(Y, 2.2);
    const a = clamp(top + bot + 0.012 + m * 0.035, 0, 0.18);
    // 混合：亮暗斑（n）＋冷灰（a）
    const L = n * 7 + 3;
    d[i] = clamp(233 + L - a * (233 - 74), 0, 255); d[i + 1] = clamp(225 + L - a * (225 - 80), 0, 255); d[i + 2] = clamp(202 + L * 0.8 - a * (202 - 88), 0, 255); d[i + 3] = 255;
  }
  sg.putImageData(im, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (HAS_FILTER) g.filter = 'blur(6px)';
  g.drawImage(s, -16, -16, VW + 32, VH + 32); g.filter = 'none';
  // 颗粒
  const T = 160, tile = mk(T, T), tg = tile.getContext('2d'), ti = tg.createImageData(T, T), td = ti.data, r = rng(5);
  for (let i = 0; i < T * T; i++) { const v = r(); const k = i * 4; if (v < 0.5) { td[k] = 90; td[k + 1] = 72; td[k + 2] = 48; td[k + 3] = r() * 7; } else { td[k] = 255; td[k + 1] = 252; td[k + 2] = 240; td[k + 3] = r() * 9; } }
  tg.putImageData(ti, 0, 0);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = g.createPattern(tile, 'repeat'); g.fillRect(0, 0, w, h); g.restore();
  // 纸纤维
  const rf = rng(77), nf = Math.round(2600 * (VW * VH) / (1920 * 1080)) + 500; g.lineCap = 'round';
  for (let i = 0; i < nf; i++) {
    const x = rf() * VW, y = rf() * VH, an = rf() * Math.PI * 2, l = 3 + rf() * 16;
    g.strokeStyle = rf() < 0.5 ? `rgba(140,118,84,${0.04 + rf() * 0.07})` : `rgba(255,252,242,${0.1 + rf() * 0.14})`;
    g.lineWidth = 0.4 + rf() * 0.6; g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(an + 0.6) * l * 0.5, y + Math.sin(an + 0.6) * l * 0.5, x + Math.cos(an) * l, y + Math.sin(an) * l); g.stroke();
  }
  // 几处淡黄水渍
  for (let i = 0; i < 5; i++) { const x = rf() * VW, y = rf() * VH, rr = (0.08 + rf() * 0.14) * Math.max(VW, VH), gg = g.createRadialGradient(x, y, 0, x, y, rr);
    gg.addColorStop(0, `rgba(170,130,70,${0.02 + rf() * 0.02})`); gg.addColorStop(1, 'rgba(170,130,70,0)'); g.fillStyle = gg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  // 暗角
  const hd = Math.hypot(VW, VH) / 2, vg = g.createRadialGradient(VW / 2, VH / 2, hd * 0.46, VW / 2, VH / 2, hd * 1.12);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(110,84,48,.22)'); g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
  return c;
}
// 小钤印（右下）：画在一个小 DOM 画布上，位置与大小交给 CSS（随屏幕、避开安全区）
function buildSeal(c) {
  const g = c.getContext('2d'); g.setTransform(2, 0, 0, 2, 90, 90);
  const r = rng(19); g.fillStyle = '#b8261c';
  g.beginPath(); g.moveTo(-31, -32); g.lineTo(31, -31); g.lineTo(32, 31); g.lineTo(-32, 32); g.closePath(); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.lineCap = 'square'; g.lineJoin = 'round';
  g.lineWidth = 3.4; g.strokeRect(-24, -24, 48, 48);
  g.lineWidth = 4.2;
  [[[-16, 2], [-6, -12], [2, -2], [10, -14], [17, 2]], [[-16, 13], [-6, 9], [4, 14], [17, 10]]].forEach(s => { g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); });
  for (let i = 0; i < 40; i++) g.fillRect(-32 + r() * 64, -32 + r() * 64, 1 + r() * 2.5, 1 + r() * 2);
  return c;
}

// ---------- 舟（离屏，尺寸变化时重画） ----------
function buildBoat() {
  const k = S * DPR, w = Math.ceil((BOX.x1 - BOX.x0) * k), h = Math.ceil((BOX.y1 - BOX.y0) * k);
  const A = mk(w, h), g = A.getContext('2d');
  BK = k; g.setTransform(k, 0, 0, k, -BOX.x0 * k, -BOX.y0 * k);
  drawBoat(g);
  const B = mk(w, h), b = B.getContext('2d');
  if (HAS_FILTER) { b.filter = `blur(${(5 * k).toFixed(2)}px)`; b.globalAlpha = 0.26; b.drawImage(A, 0, 0); b.filter = 'none'; b.globalAlpha = 1; }   // 墨晕
  b.drawImage(A, 0, 0);
  return B;
}

// ---------- 疏雪 ----------
function buildSnow() {
  if (!flakeImg) {
    flakeImg = mk(32, 32); const g = flakeImg.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,252,1)'); gr.addColorStop(0.35, 'rgba(252,250,244,.8)'); gr.addColorStop(0.6, 'rgba(170,174,178,.14)'); gr.addColorStop(1, 'rgba(120,125,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  }
  // 雪片数随面积、上限 30；大小随短边微调
  const r = rng(58), n = reduced ? 8 : Math.round(clamp(VW * VH / 46000, 10, 30)), fs = clamp(Math.min(VW, VH) / 800, 0.75, 1.15);
  flakes = [];
  for (let i = 0; i < n; i++) flakes.push({ x: r() * (VW + 40), y: r() * (VH + 40), s: (4 + r() * 5) * fs, v: 9 + r() * 16, a: 0.35 + r() * 0.35, f: 0.3 + r() * 0.6, ph: r() * 7, amp: 6 + r() * 12, par: 0.25 + r() * 0.35 });
}

// ---------- 布局 ----------
// 分段线性：按宽高比取值（连续，旋转/拖窗时不会跳）
const pw = (x, T) => { if (x <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (x <= T[i][0]) return lerp(T[i - 1][1], T[i][1], (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0])); return T[T.length - 1][1]; };
const LOWEND = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;
let LW = 0, LH = 0, LD = 0;
function layout(force) {
  const w = cv.clientWidth || window.innerWidth, h = cv.clientHeight || window.innerHeight;
  // 像素比：最高 2；低端机 1.5；画布超过约 8MP 时再降，但不低于 1
  let dpr = Math.min(window.devicePixelRatio || 1, LOWEND ? 1.5 : 2);
  if (w * h * dpr * dpr > 8e6) dpr = Math.max(1, Math.sqrt(8e6 / (w * h)));
  if (!force && w === LW && h === LH && dpr === LD) return;
  LW = VW = w; LH = VH = h; LD = DPR = dpr;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  const asp = VW / VH;
  PORTRAIT = asp < 0.9;
  // 船长（400u）占屏宽：窄竖屏 45% → 平板竖 39% → 方屏 30% → 横屏 22%；
  // 再受屏高约束（矮屏略放宽，免得手机横屏时舟太小）
  const frac = pw(asp, [[0.5, 0.45], [0.75, 0.39], [1.0, 0.30], [1.4, 0.22]]);
  S = Math.min(frac * VW / 400, VH * lerp(0.0012, 0.00105, ss(420, 720, VH)));
  // 锚点（吃水线中点）：竖屏居中略偏左、略高于中线；横屏偏左、略低
  const land = ss(0.85, 1.15, asp);
  AX = lerp(VW * 0.5 - 70 * S, VW * 0.375, land);
  AY = VH * lerp(0.515, 0.585, land);
  paper = buildPaper(); boat = buildBoat(); buildSnow();
}
let rsT = 0;
const onResize = () => { clearTimeout(rsT); rsT = setTimeout(() => layout(false), 180); };
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);
mq.addEventListener?.('change', e => { reduced = e.matches; buildSnow(); });

// ---------- 交互 ----------
function markInput() {
  st.idle = 0;
  if (!st.moved) { st.moved = true; document.body.classList.add('moved'); }
  if (st.poemOn) hidePoem(true);
}
function stroke() {
  markInput();
  if (st.t - st.lastStroke < 0.45) return;
  st.lastStroke = st.t;
  st.vx = Math.min(st.vx + 150, 330);
  st.pitchV -= 0.045 * (reduced ? 0.4 : 1);
  const sd = (Math.random() * 1000) | 0;
  rings.push({ x: st.bx - 168, y: WATER - 4, t0: st.t, life: 5.2, rmax: 150, flat: 0.2, tone: 0.3, seed: sd, rot: Math.random() * 0.4 });
  rings.push({ x: st.bx - 70, y: WATER + 2, t0: st.t + 0.4, life: 4.6, rmax: 115, flat: 0.22, tone: 0.2, seed: sd + 7, rot: Math.random() * 0.4 });
  trails.push({ x: st.bx - 150, y: WATER - 6, t0: st.t, life: 5.5, len: 240, dir: -1, tone: 0.22, seed: sd + 3 });
  trails.push({ x: st.bx - 120, y: WATER + 14, t0: st.t + 0.15, life: 5, len: 190, dir: 1, tone: 0.15, seed: sd + 5 });
  if (rings.length > 40) rings.splice(0, rings.length - 40);
  if (trails.length > 16) trails.splice(0, trails.length - 16);
}
const FWD = new Set(['KeyW', 'ArrowUp', 'Space']), LEFT = new Set(['KeyA', 'ArrowLeft']), RIGHT = new Set(['KeyD', 'ArrowRight']);
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (FWD.has(e.code)) { e.preventDefault(); if (!e.repeat) { keys.fwd = true; stroke(); } }
  else if (LEFT.has(e.code)) { e.preventDefault(); keys.left = true; markInput(); }
  else if (RIGHT.has(e.code)) { e.preventDefault(); keys.right = true; markInput(); }
});
window.addEventListener('keyup', e => {
  if (FWD.has(e.code)) keys.fwd = false; else if (LEFT.has(e.code)) keys.left = false; else if (RIGHT.has(e.code)) keys.right = false;
});
window.addEventListener('blur', () => { keys.fwd = keys.left = keys.right = false; touch.dir = 0; touch.id = null; });
// 指针：鼠标按下即一桨；触控/笔——轻触（抬起时未拖动）＝一桨，左右轻扫＝随波（按住时持续，松手后余波渐止）
const touch = { id: null, x0: 0, y0: 0, t0: 0, swipe: false, dir: 0, until: 0 };
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') { if (e.button === 0) stroke(); return; }
  if (touch.id !== null) return;                       // 只认第一根手指
  touch.id = e.pointerId; touch.x0 = e.clientX; touch.y0 = e.clientY; touch.t0 = performance.now(); touch.swipe = false;
  cv.setPointerCapture?.(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x0, dy = e.clientY - touch.y0;
  if (!touch.swipe && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) { touch.swipe = true; markInput(); }
  if (touch.swipe) { touch.dir = Math.abs(dx) > 6 ? Math.sign(dx) : 0; touch.until = Infinity; }
});
const endTouch = (e, cancel) => {
  if (e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x0, dy = e.clientY - touch.y0;
  if (touch.swipe) touch.until = st.t + clamp(Math.abs(dx) / Math.min(VW, 700) * 2.2, 0.5, 1.8);   // 余波
  else if (!cancel && Math.hypot(dx, dy) < 16 && performance.now() - touch.t0 < 600) stroke();
  touch.id = null; touch.swipe = false;
};
cv.addEventListener('pointerup', e => endTouch(e, false));
cv.addEventListener('pointercancel', e => endTouch(e, true));
cv.addEventListener('contextmenu', e => e.preventDefault());

// ---------- 题诗（久静之后，右侧一行淡字） ----------
const POEMS = [['孤舟蓑笠翁', '独钓寒江雪'], ['千山鸟飞绝', '万径人踪灭']];
const poemEl = document.querySelector('.poem');
let poemTimer = 0;
function showPoem() {
  const p = POEMS[st.poemIdx++ % POEMS.length];
  poemEl.textContent = ''; p.forEach((l, i) => { if (i) poemEl.appendChild(document.createElement('br')); poemEl.appendChild(document.createTextNode(l)); });
  poemEl.classList.remove('quick'); void poemEl.offsetWidth; poemEl.classList.add('on'); st.poemOn = true;
  clearTimeout(poemTimer); poemTimer = setTimeout(() => hidePoem(false), 11000);
}
function hidePoem(quick) {
  clearTimeout(poemTimer); poemEl.classList.toggle('quick', !!quick); poemEl.classList.remove('on'); st.poemOn = false;
  st.poemAt = st.idle + (quick ? 16 : 34);
}

// ---------- 更新 ----------
function update(dt) {
  st.t += dt; st.idle += dt;
  if (keys.fwd && st.t - st.lastStroke > 1.25) stroke();          // 按住：一桨一桨，不连发
  if (touch.dir && touch.id === null && st.t > touch.until) touch.dir = 0;
  const acc = clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + touch.dir, -1, 1);
  st.vx += acc * 42 * dt;
  st.vx *= Math.exp(-0.72 * dt);
  st.bx += st.vx * dt;
  // 镜头慢随（临界阻尼弹簧），并保证舟始终在构图里
  const w = 0.75; st.camV += (w * w * (st.bx - st.camX) - 2 * w * st.camV) * dt; st.camX += st.camV * dt;
  // 舟相对锚点能偏多远：最多 16% / 20% 屏宽，且船尾、竿梢都不出画（竖屏余地小）
  const pad = 10, offMin = -Math.max(0, Math.min(0.16 * VW, AX + BOX.x0 * S - pad)) / S,
    offMax = Math.max(0, Math.min(0.2 * VW, VW - pad - AX - (ROD_TIP[0] + 30) * S)) / S, off = st.bx - st.camX;
  if (off > offMax) st.camX = st.bx - offMax; else if (off < offMin) st.camX = st.bx - offMin;
  // 船头起伏（划桨后轻轻一抬）
  st.pitchV += (-14 * st.pitch - 3.2 * st.pitchV) * dt; st.pitch += st.pitchV * dt;
  // 钓丝入水点拖在后面
  st.hookX += (st.bx + ROD_TIP[0] + 16 - st.hookX) * (1 - Math.exp(-dt * 0.9));
  // 钓丝处的水纹，一圈一圈慢慢呼出
  if (st.t >= st.nextRing) {
    rings.push({ x: st.hookX, y: WATER, t0: st.t, life: reduced ? 5.4 : 4.6, rmax: 92, flat: 0.27, tone: 0.5, seed: 600 + ((st.t * 10) | 0) % 37, rot: 0, hook: true });
    st.nextRing = st.t + (reduced ? 2.4 : 1.55);
  }
  for (let i = rings.length - 1; i >= 0; i--) if (st.t - rings[i].t0 > rings[i].life) rings.splice(i, 1);
  for (let i = trails.length - 1; i >= 0; i--) if (st.t - trails[i].t0 > trails[i].life) trails.splice(i, 1);
  if (!st.poemOn && st.idle > st.poemAt) showPoem();
}

// ---------- 绘制 ----------
const SX = x => AX + (x - st.camX) * S, SY = y => AY + y * S;
const ARCS = [[-0.15, 0.4], [0.55, 1.05], [1.2, 1.75]];
function drawRing(R) {
  const age = st.t - R.t0; if (age < 0) return;
  const u = age / R.life, a = R.tone * Math.pow(1 - u, 1.4); if (a < 0.012) return;
  const r = 6 + R.rmax * Math.pow(u, 0.65), cx = SX(R.x), cy = SY(R.y), rx = r * S, ry = r * R.flat * S;
  if (cx + rx < -20 || cx - rx > VW + 20) return;
  ARCS.forEach(([a0, a1], k) => {
    const pts = []; for (let i = 0; i <= 10; i++) { const th = (lerp(a0, a1, i / 10) + R.rot) * Math.PI; pts.push([cx + Math.cos(th) * rx, cy + Math.sin(th) * ry]); }
    brush(ctx, pts, { w: Math.max(0.8, (1 + 2.4 * (1 - u)) * S), tone: a, dry: 0.55 + 0.3 * u, seed: R.seed + k, bristles: 3, head: 0.2, tail: 0.4, step: 3 });
  });
}
function drawTrail(T) {
  const age = st.t - T.t0; if (age < 0) return;
  const u = age / T.life, a = T.tone * Math.pow(1 - u, 1.5); if (a < 0.012) return;
  const L = T.len * easeOut(clamp(age / 2.4)), x = SX(T.x), y = SY(T.y + T.dir * 10 * easeOut(u));
  if (x < -20 || x - L * S > VW + 20 || L < 8) return;
  brush(ctx, [[x, y], [x - L * 0.5 * S, y + T.dir * 3 * S], [x - L * S, y + T.dir * 8 * S]], { w: 3.2 * S, tone: a, dry: 0.7, seed: T.seed, bristles: 4, head: 0.25, tail: 0.55 });
}
function frame(now) {
  const t = now / 1000, dt = clamp(t - (frame.last || t), 0, 0.05); frame.last = t;
  update(dt);
  const m = reduced ? 0.3 : 1, T = st.t;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(paper, 0, 0, VW, VH);

  // 舟的浮沉
  const dx = 2.4 * Math.sin(T * 0.6 + 0.4) * m;
  const dy = (3.2 * Math.sin(T * 2 * Math.PI / 3.6) + 1.1 * Math.sin(T * 2 * Math.PI / 2.1 + 1)) * m;
  const rot = 0.01 * Math.sin(T * 2 * Math.PI / 3.6 + 0.9) * m + st.pitch;
  const bx = SX(st.bx + dx), by = SY(dy);
  const appear = ss(0.1, 2.4, T);   // 开场：墨从纸里慢慢显出来

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = appear;
  for (const R of trails) drawTrail(R);
  for (const R of rings) drawRing(R);
  // 船下两笔淡水纹（随舟晃，滑行时略拉长）
  const stretch = 1 + 0.35 * clamp(st.vx / 220);
  [[-150, 30, 230, 0.26, 0], [-20, 50, 150, 0.17, 1]].forEach(([x0, y0, len, tone, i]) => {
    const x = SX(st.bx + dx * 0.6 + x0 + 6 * Math.sin(T * 1.2 + i * 2) * m - (stretch - 1) * len * 0.6), y = SY(y0 + dy * 0.35), Ls = len * stretch * S;
    brush(ctx, [[x, y], [x + Ls * 0.5, y + 2 * S * Math.sin(T * 1.1 + i)], [x + Ls, y - S]], { w: 3.4 * S, tone, dry: 0.75, seed: 700 + i, bristles: 4, head: 0.25, tail: 0.55 });
  });
  // 舟
  ctx.save(); ctx.translate(bx, by); ctx.rotate(rot);
  ctx.drawImage(boat, BOX.x0 * S, BOX.y0 * S, boat.width / DPR, boat.height / DPR);
  ctx.restore();
  // 钓丝：竿梢 → 入水点（拖后、下垂）
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const tx = bx + (ROD_TIP[0] * cs - ROD_TIP[1] * sn) * S, ty = by + (ROD_TIP[0] * sn + ROD_TIP[1] * cs) * S;
  const ex = SX(st.hookX), ey = SY(WATER + 1.2 * Math.sin(T * 1.3) * m);
  const mx = (tx + ex) / 2 + (3 * Math.sin(T * 0.9) + 1.5 * Math.sin(T * 2.3)) * S * m, my = (ty + ey) / 2 + (12 + 4 * Math.sin(T * 1.3) * m) * S;
  ctx.strokeStyle = 'rgba(20,18,16,.5)'; ctx.lineWidth = Math.max(0.7, 1.2 * S); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();

  // 疏雪（屏幕层，随镜头有一点视差）
  ctx.globalCompositeOperation = 'source-over';
  const sp = reduced ? 0.35 : 1;
  for (const F of flakes) {
    const y = ((F.y + F.v * T * sp) % (VH + 40)) - 20;
    const x = (((F.x - st.camX * S * F.par - 7 * T * sp + F.amp * Math.sin(T * F.f * sp + F.ph)) % (VW + 40)) + VW + 40) % (VW + 40) - 20;
    ctx.globalAlpha = F.a * ss(0, 2, T); ctx.drawImage(flakeImg, x - F.s / 2, y - F.s / 2, F.s, F.s);
  }
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}
// 页面隐藏时停下，回来时从停下处接着走（不跳帧）
let raf = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
  else if (!raf) { frame.last = 0; raf = requestAnimationFrame(frame); }
});

buildSeal(document.querySelector('.seal'));
layout(true);
// 调试（截图用，只影响开场的模拟时间，无副作用）：
//   #t=8 先快进 8 秒；#t=8&row=2 在快进末段划 2 桨；#t=8&poem 立刻显出题诗（无淡入）；#debug 暴露只读状态给自动测试
{ const h = location.hash, m = /[#&]t=([\d.]+)/.exec(h), rw = /[#&]row=(\d+)/.exec(h);
  if (m) { const n = Math.round(Math.min(60, +m[1]) * 60), k = rw ? Math.min(5, +rw[1]) : 0, s0 = n - 150 - k * 54;
    for (let i = 0; i < n; i++) { if (k && i >= s0 && i < s0 + k * 54 && (i - s0) % 54 === 0) stroke(); update(1 / 60); } }
  if (/[#&]poem\b/.test(h)) { poemEl.style.transition = 'none'; showPoem(); clearTimeout(poemTimer); }
  if (/[#&]debug\b/.test(h)) window.__wubian = { st, touch, rings, trails, get layout() { return { VW, VH, DPR, S, AX, AY }; } }; }
raf = requestAnimationFrame(frame);
})();
