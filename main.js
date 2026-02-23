/* ═══════════════════════════════════════════════════════════
   Discrete Flow Maps — Scroll-driven Canvas Animations
   No dependencies beyond KaTeX (loaded in HTML).
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ════════════════════════════════════════════════════════════
//  COLORS  (from mean_denoiser.py / stochastic_interpolant_frame.py)
// ════════════════════════════════════════════════════════════
const C = {
  bg:          '#ffffff',
  ink:         '#2e4552',
  teal:        '#2f533f',
  maroon:      '#965c58',
  simplexFill: '#f2eee0',
  boxEdge:     '#c3c3c3',
  cloud:       '#90a0aa',
  gold:        '#d4a843',
  green1:      '#2f533f',
  green2:      '#3d604c',
  green3:      '#4c6b5a',
  red:         '#c0504d',
  redLight:    '#d4837f',
};

// Barycentric probabilities (mean_denoiser.py line 52)
const P_FOX = 0.32, P_DOG = 0.14, P_CAT = 0.54;
const MEAN_XS_PARAM = 0.16;
const MEAN_XT_PARAM = 0.34;
const MEAN_PSI_INTERIOR_FRAC = 0.35;
const LOSS_S_PARAM = 0.16;
const LOSS_U_PARAM = 0.25;
const LOSS_T_PARAM = 0.40;
const LOSS_S2_PARAM = 0.08;

// ════════════════════════════════════════════════════════════
//  MATH UTILITIES
// ════════════════════════════════════════════════════════════
const lerp  = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function bary(v1, v2, v3, w1, w2, w3) {
  return [
    w1 * v1[0] + w2 * v2[0] + w3 * v3[0],
    w1 * v1[1] + w2 * v2[1] + w3 * v3[1],
  ];
}

function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
    u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1],
  ];
}

function cubicBezierDerivative(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ];
}

function cubicBezierPoints(p0, p1, p2, p3, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(cubicBezier(p0, p1, p2, p3, i / n));
  return pts;
}

function archedConnectorPoints(p0, p1, bump = 14, n = 72) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d, ny = dx / d;
  // Canvas y grows downward; prefer an upward arch.
  if (ny > 0) { nx = -nx; ny = -ny; }
  const b = Math.min(bump, 0.6 * d);
  const c1 = [lerp(p0[0], p1[0], 0.33) + nx * b, lerp(p0[1], p1[1], 0.33) + ny * b];
  const c2 = [lerp(p0[0], p1[0], 0.66) + nx * b, lerp(p0[1], p1[1], 0.66) + ny * b];
  return cubicBezierPoints(p0, c1, c2, p1, n);
}

// Open-curve Chaikin subdivision: smooths a polyline while preserving endpoints.
function chaikinSmooth(points, iterations = 2) {
  if (!points || points.length < 3 || iterations <= 0) return points ? points.slice() : [];
  let pts = points.map(p => [p[0], p[1]]);
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) break;
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      next.push([
        0.75 * p[0] + 0.25 * q[0],
        0.75 * p[1] + 0.25 * q[1],
      ]);
      next.push([
        0.25 * p[0] + 0.75 * q[0],
        0.25 * p[1] + 0.75 * q[1],
      ]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

// Easing
const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
const easeOut   = t => 1 - (1 - t) * (1 - t);

// Clamp
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const trajIdxFromParam = (pts, t) =>
  Math.max(0, Math.min(pts.length - 1, Math.round(t * (pts.length - 1))));

// ── Ray–line-segment intersection (2D) ──
// Returns the point where the ray from `origin` through `through` hits
// the line segment from `a` to `b`, or null if it doesn't hit.
function raySegmentIntersect(origin, through, a, b) {
  const dx = through[0] - origin[0], dy = through[1] - origin[1];
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((a[0] - origin[0]) * ey - (a[1] - origin[1]) * ex) / denom;
  const u = ((a[0] - origin[0]) * dy - (a[1] - origin[1]) * dx) / denom;
  if (t > 0.01 && u >= 0 && u <= 1) {
    return [origin[0] + t * dx, origin[1] + t * dy];
  }
  return null;
}

// Same intersection, but also return the ray parameter t so we can recover
// the secant chord through the simplex and place points inside it.
function raySegmentIntersectWithT(origin, through, a, b) {
  const dx = through[0] - origin[0], dy = through[1] - origin[1];
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((a[0] - origin[0]) * ey - (a[1] - origin[1]) * ex) / denom;
  const u = ((a[0] - origin[0]) * dy - (a[1] - origin[1]) * dx) / denom;
  if (t > 0.01 && u >= 0 && u <= 1) {
    return {
      t,
      point: [origin[0] + t * dx, origin[1] + t * dy],
    };
  }
  return null;
}

// Find where the ray from `origin` through `through` intersects the simplex
// triangle defined by three vertices. Returns the intersection point on the
// triangle edge, or a fallback if no intersection found.
function raySimplexHit(origin, through, v0, v1, v2) {
  // Try all three edges
  const edges = [[v0, v1], [v1, v2], [v2, v0]];
  let best = null, bestDist = Infinity;
  for (const [a, b] of edges) {
    const hit = raySegmentIntersect(origin, through, a, b);
    if (hit) {
      const d = dist2(through, hit);
      if (d < bestDist) { bestDist = d; best = hit; }
    }
  }
  return best;
}

// Returns the ordered secant chord intersections (entry, exit) of the ray
// from `origin` through `through` with the simplex triangle. Duplicates from
// grazing a vertex are de-duplicated by ray parameter.
function raySimplexChord(origin, through, v0, v1, v2) {
  const edges = [[v0, v1], [v1, v2], [v2, v0]];
  const hits = [];
  for (const [a, b] of edges) {
    const hit = raySegmentIntersectWithT(origin, through, a, b);
    if (!hit) continue;
    if (hits.some(h => Math.abs(h.t - hit.t) < 1e-6)) continue;
    hits.push(hit);
  }
  hits.sort((h1, h2) => h1.t - h2.t);
  return hits;
}

// Infer the interior secant-chord fraction whose tangent-limit point matches
// a specified simplex point (here ψ_{s,s}). This makes the ψ_{s,u} path start
// smoothly from ψ_{s,s} as u ↓ s.
function chordFracForPointOnRayChord(origin, through, point, v0, v1, v2, fallback = 0.35) {
  const chord = raySimplexChord(origin, through, v0, v1, v2);
  if (chord.length < 2) return fallback;
  const a = chord[0].point, b = chord[1].point;
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const denom = abx * abx + aby * aby;
  if (denom < 1e-9) return fallback;
  const t = ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / denom;
  return clamp(t, 0.02, 0.98);
}

// ════════════════════════════════════════════════════════════
//  SIMPLEX RENDERER — core 2D Canvas drawing engine
// ════════════════════════════════════════════════════════════
class SimplexRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width  = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Compute simplex geometry — equilateral-ish triangle centered in canvas
    const pad = 0.18;
    const usableW = this.w * (1 - 2 * pad);
    const usableH = this.h * (1 - 2 * pad);
    const scl = Math.min(usableW / 3.6, usableH / 3.4);

    const cx = this.w / 2;
    const cy = this.h * 0.44;

    // fox = bottom-left, dog = top, cat = bottom-right (matching mean_denoiser.py)
    this.vFox = [cx - scl * 1.8, cy + scl * 1.0];
    this.vCat = [cx + scl * 1.8, cy + scl * 1.0];
    this.vDog = [cx,             cy - scl * 1.4];
    this.scale = scl;
    this.cx = cx;
    this.cy = cy;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  // ── Drawing primitives ──

  drawTriangle(opacity = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity * 0.5;
    ctx.beginPath();
    ctx.moveTo(...this.vFox);
    ctx.lineTo(...this.vDog);
    ctx.lineTo(...this.vCat);
    ctx.closePath();
    ctx.fillStyle = C.simplexFill;
    ctx.fill();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  dot(pos, color = C.ink, r = 5, opacity = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(pos[0], pos[1], r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  label(text, pos, opts = {}) {
    const { color = C.ink, size = 17, bold = true, align = 'center', baseline = 'middle', opacity = 1 } = opts;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${bold ? '600' : '400'} ${size}px Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, pos[0], pos[1]);
    ctx.restore();
  }

  mathLabel(text, pos, opts = {}) {
    const { color = C.ink, size = 18, italic = true, opacity = 1 } = opts;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${italic ? 'italic ' : ''}${size}px 'KaTeX_Math', 'Times New Roman', serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pos[0], pos[1]);
    ctx.restore();
  }

  weightedLine(from, to, weight, color = C.teal, maxW = 7, opacity = 0.7) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.strokeStyle = color;
    ctx.lineWidth = maxW * weight;
    ctx.stroke();
    ctx.restore();
  }

  dashedLine(from, to, color = C.teal, lw = 2, opacity = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.restore();
  }

  curve(pts, color = C.ink, lw = 3, opacity = 1) {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  curveSmooth(pts, color = C.ink, lw = 3, opacity = 1, iterations = 2) {
    if (!pts || pts.length < 2) return;
    if (pts.length < 4 || iterations <= 0) {
      this.curve(pts, color, lw, opacity);
      return;
    }
    this.curve(chaikinSmooth(pts, iterations), color, lw, opacity);
  }

  // Short tangent segment at a point, aimed at a target direction
  tangentLine(pos, target, len = 40, color = C.teal, lw = 3, opacity = 1) {
    const dx = target[0] - pos[0], dy = target[1] - pos[1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const ux = dx / d, uy = dy / d;
    const a = [pos[0] - len * ux, pos[1] - len * uy];
    const b = [pos[0] + len * ux, pos[1] + len * uy];
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // One-sided tangent ray from `pos` toward `target` (avoids drawing the
  // backward extension through labels like x_0).
  tangentRay(pos, target, len = 40, color = C.teal, lw = 3, opacity = 1) {
    const dx = target[0] - pos[0], dy = target[1] - pos[1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const ux = dx / d, uy = dy / d;
    const end = [pos[0] + len * ux, pos[1] + len * uy];
    this.curve([pos, end], color, lw, opacity);
  }

  arrow(from, to, color = C.maroon, lw = 2.5, opacity = 1) {
    const ctx = this.ctx;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const angle = Math.atan2(dy, dx);
    const headLen = 10;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - headLen * Math.cos(angle - 0.35), to[1] - headLen * Math.sin(angle - 0.35));
    ctx.lineTo(to[0] - headLen * Math.cos(angle + 0.35), to[1] - headLen * Math.sin(angle + 0.35));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // Helper: barycentric → pixel
  bary(w1, w2, w3) {
    return bary(this.vFox, this.vDog, this.vCat, w1, w2, w3);
  }

  // ODE trajectory: CubicBezier from x0 (below simplex) to fox vertex.
  // Tuned so the true tangent at x_s aligns with ψ_{s,s}, while the secant
  // (x_s, x_t) still produces an interior ψ_{s,t} on the simplex.
  trajectoryData() {
    const s = this.scale;
    const baseY = this.vFox[1]; // y of the base edge (fox and cat share this)
    // x0: below the simplex, near center
    const x0 = [this.cx + s * 0.022, baseY + s * 1.719];
    const x1 = [...this.vFox];
    // Control points from a small search over visually plausible curves.
    const cp1 = [x0[0] + s * 0.608, x0[1] - s * 1.204];
    const cp2 = [x1[0] + s * 1.399, x1[1] + s * 0.400];
    return { x0, x1, cp1, cp2 };
  }

  trajectoryPoint(t) {
    const { x0, cp1, cp2, x1 } = this.trajectoryData();
    return cubicBezier(x0, cp1, cp2, x1, t);
  }

  trajectoryTangent(t) {
    const { x0, cp1, cp2, x1 } = this.trajectoryData();
    return cubicBezierDerivative(x0, cp1, cp2, x1, t);
  }

  trajectoryPoints(n = 100) {
    const { x0, cp1, cp2, x1 } = this.trajectoryData();
    return cubicBezierPoints(x0, cp1, cp2, x1, n);
  }

  // Compute ψ_{s,t} from the secant geometry. By default this returns the
  // first ray hit on the simplex boundary. When `insideFrac > 0`, it returns
  // a point deeper along the secant chord inside the simplex (still collinear
  // with x_s and x_t), which better matches the mean_denoiser.py visual.
  psiFromSecant(xs, xt, insideFrac = 0) {
    const chord = raySimplexChord(xs, xt, this.vFox, this.vDog, this.vCat);
    const hit = chord[0]?.point || null;
    if (!hit) return lerp2(xt, this.vFox, 0.3); // fallback toward fox
    if (!(insideFrac > 0) || chord.length < 2) return hit;
    const frac = clamp(insideFrac, 0, 1);
    return lerp2(chord[0].point, chord[1].point, frac);
  }

  // Draw vertex labels + dots
  drawVertices(opacity = 1) {
    this.dot(this.vFox, C.ink, 5, opacity);
    this.dot(this.vDog, C.ink, 5, opacity);
    this.dot(this.vCat, C.ink, 5, opacity);
  }

  drawVertexLabels(opacity = 1) {
    const off = 26;
    this.label('fox', [this.vFox[0] - off, this.vFox[1] + 8], { opacity, align: 'right' });
    this.label('dog', [this.vDog[0], this.vDog[1] - off],      { opacity });
    this.label('cat', [this.vCat[0] + off, this.vCat[1] + 8],  { opacity, align: 'left' });
  }

  drawOneHotLabels(opacity = 1) {
    const sz = 14;
    const opts = { size: sz, color: C.ink, italic: false, opacity };
    this.mathLabel('(1,0,0)', [this.vFox[0] - 28, this.vFox[1] + 26], opts);
    this.mathLabel('(0,1,0)', [this.vDog[0], this.vDog[1] - 40], opts);
    this.mathLabel('(0,0,1)', [this.vCat[0] + 28, this.vCat[1] + 26], opts);
  }
}


// ════════════════════════════════════════════════════════════
//  ANIMATION STATE — step transition with easing
// ════════════════════════════════════════════════════════════
class Anim {
  constructor() {
    this.step = -1;       // current target step
    this.progress = {};   // step -> 0..1 progress
    this.speed = 2.2;     // transitions per second
  }

  setStep(s) { this.step = s; }

  // Get progress for step s (0 = hidden, 1 = fully shown)
  p(s) { return clamp(this.progress[s] || 0, 0, 1); }

  tick(dt) {
    let dirty = false;
    // Advance active steps, retract inactive ones
    for (let s = 0; s <= Math.max(this.step, ...Object.keys(this.progress).map(Number)); s++) {
      const prev = this.progress[s] || 0;
      if (s <= this.step) {
        this.progress[s] = clamp(prev + dt * this.speed, 0, 1);
      } else {
        this.progress[s] = clamp(prev - dt * this.speed * 1.5, 0, 1);
      }
      if (this.progress[s] !== prev) dirty = true;
    }
    return dirty;
  }

  // Eased progress for step s
  e(s) { return easeInOut(this.p(s)); }
}


// ════════════════════════════════════════════════════════════
//  SECTION CONTROLLERS
// ════════════════════════════════════════════════════════════

// ─── A: The Simplex ───
class SectionSimplex {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const tri = a.e(0);
    if (tri > 0) {
      r.drawTriangle(tri);
      r.drawVertices(tri);
      r.drawVertexLabels(tri);
    }

    const labels = a.e(1);
    if (labels > 0) {
      r.drawOneHotLabels(labels);

      // Animate a sample point drifting inside the simplex
      const t = (performance.now() / 4000) % 1;
      const w1 = 0.33 + 0.15 * Math.sin(t * Math.PI * 2);
      const w2 = 0.33 + 0.10 * Math.cos(t * Math.PI * 2 + 1);
      const w3 = 1 - w1 - w2;
      const pt = r.bary(w1, w2, w3);
      r.dot(pt, C.cloud, 4, labels * 0.5);
    }
  }
}

// ─── B: Instantaneous Denoiser ψ_{s,s} ───
class SectionDenoiserInst {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    // Always show simplex
    r.drawTriangle(1);
    r.drawVertices(1);
    r.drawVertexLabels(1);

    const psiPos = r.bary(P_FOX, P_DOG, P_CAT);

    // Step 0: weighted lines grow
    const lnT = a.e(0);
    if (lnT > 0) {
      const foxEnd = lerp2(r.vFox, psiPos, lnT);
      const dogEnd = lerp2(r.vDog, psiPos, lnT);
      const catEnd = lerp2(r.vCat, psiPos, lnT);
      r.weightedLine(r.vFox, foxEnd, P_FOX, C.teal, 8, 0.55 * lnT);
      r.weightedLine(r.vDog, dogEnd, P_DOG, C.teal, 8, 0.55 * lnT);
      r.weightedLine(r.vCat, catEnd, P_CAT, C.teal, 8, 0.55 * lnT);

      // p labels
      if (lnT > 0.5) {
        const lo = (lnT - 0.5) * 2;
        r.mathLabel('p\u2081', lerp2(r.vFox, psiPos, 0.45).map((v, i) => v + (i === 1 ? -14 : 0)), { color: C.ink, size: 16, opacity: lo });
        r.mathLabel('p\u2082', lerp2(r.vDog, psiPos, 0.42).map((v, i) => v + (i === 0 ? -14 : 0)), { color: C.ink, size: 16, opacity: lo });
        r.mathLabel('p\u2083', lerp2(r.vCat, psiPos, 0.48).map((v, i) => v + (i === 1 ? -14 : 0)), { color: C.ink, size: 16, opacity: lo });
      }
    }

    // Step 1: ψ_{s,s} dot + label
    const dotT = a.e(1);
    if (dotT > 0) {
      // Full weighted lines
      r.weightedLine(r.vFox, psiPos, P_FOX, C.teal, 8, 0.55);
      r.weightedLine(r.vDog, psiPos, P_DOG, C.teal, 8, 0.55);
      r.weightedLine(r.vCat, psiPos, P_CAT, C.teal, 8, 0.55);

      r.dot(psiPos, C.teal, 7 * dotT, dotT);
      r.mathLabel('\u03C8\u209B,\u209B', [psiPos[0] + 20, psiPos[1] - 16], { color: C.teal, size: 18, opacity: dotT });
    }
  }
}

// ─── C: Mean Denoiser ψ_{s,t} ───
class SectionMeanDenoiser {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._trajPts = null;
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); this._trajPts = null; }

  get trajPts() {
    if (!this._trajPts) this._trajPts = this.r.trajectoryPoints(120);
    return this._trajPts;
  }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    r.drawTriangle(1);
    r.drawVertices(1);
    r.drawVertexLabels(1);

    const pts = this.trajPts;
    const xsParam = MEAN_XS_PARAM;
    const xtParam = MEAN_XT_PARAM;
    const xs = r.trajectoryPoint(xsParam);
    const xt = r.trajectoryPoint(xtParam);
    const x0 = pts[0];
    const x1 = pts[pts.length - 1];
    const psiSS = r.bary(P_FOX, P_DOG, P_CAT);
    const tangentVec = r.trajectoryTangent(xsParam);
    const tangentTarget = [xs[0] + tangentVec[0], xs[1] + tangentVec[1]];
    const psiInsideFrac = chordFracForPointOnRayChord(
      xs, tangentTarget, psiSS, r.vFox, r.vDog, r.vCat, MEAN_PSI_INTERIOR_FRAC
    );
    // ψ_{s,t} is chosen along the secant chord inside the simplex.
    const psiST = r.psiFromSecant(xs, xt, psiInsideFrac);
    // Smooth visual connector on the simplex between ψ_{s,s} and ψ_{s,t}.
    const psiConnectorPts = archedConnectorPoints(psiSS, psiST, 0.14 * r.scale, 84);

    // Step 0: trajectory curve
    const curveT = a.e(0);
    if (curveT > 0) {
      const numPts = Math.floor(curveT * pts.length);
      r.curve(pts.slice(0, numPts + 1), '#2e4552', 3, curveT);

      r.dot(x0, C.maroon, 5, curveT);
      r.mathLabel('x\u2080', [x0[0] + 16, x0[1] + 4], { color: C.maroon, size: 17, opacity: curveT });

      if (curveT > 0.95) {
        r.mathLabel('x\u2081', [x1[0] - 8, x1[1] + 18], { color: C.maroon, size: 17, opacity: 1 });
      }
    }

    // Step 1: mark x_s, x_t + tangent at x_s → ψ_{s,s} projection
    const markT = a.e(1);
    if (markT > 0) {
      // Full trajectory
      r.curve(pts, '#2e4552', 3, 1);
      r.dot(x0, C.maroon, 5);
      r.mathLabel('x\u2080', [x0[0] + 16, x0[1] + 4], { color: C.maroon, size: 17 });
      r.mathLabel('x\u2081', [x1[0] - 8, x1[1] + 18], { color: C.maroon, size: 17 });

      r.dot(xs, C.maroon, 5, markT);
      r.dot(xt, C.maroon, 5, markT);
      r.mathLabel('x\u209B', [xs[0] + 16, xs[1] + 2], { color: C.maroon, size: 17, opacity: markT });
      r.mathLabel('x\u209C', [xt[0] - 18, xt[1] + 2], { color: C.maroon, size: 17, opacity: markT });

      // True cubic tangent at x_s. The curve is tuned so this aligns with ψ_{s,s}.
      r.tangentRay(xs, tangentTarget, 0.80 * r.scale, C.teal, 2.5, markT * 0.8);

      // Dashed projection from x_s to ψ_{s,s}
      const dashEnd = lerp2(xs, psiSS, markT);
      r.dashedLine(xs, dashEnd, C.teal, 2, markT * 0.7);
      if (markT > 0.7) {
        const dp = (markT - 0.7) / 0.3;
        r.dot(psiSS, C.teal, 6, dp);
        r.mathLabel('\u03C8\u209B,\u209B', [psiSS[0] + 18, psiSS[1] - 14], { color: C.teal, size: 17, opacity: dp });
      }
    }

    // Step 2: sweep psi path on simplex from ψ_{s,s} to ψ_{s,t}
    const sweepT = a.e(2);
    if (sweepT > 0) {
      // Draw everything from step 1 fully
      r.curve(pts, '#2e4552', 3, 1);
      r.dot(x0, C.maroon, 5); r.dot(xs, C.maroon, 5); r.dot(xt, C.maroon, 5);
      r.mathLabel('x\u2080', [x0[0] + 16, x0[1] + 4], { color: C.maroon, size: 17 });
      r.mathLabel('x\u209B', [xs[0] + 16, xs[1] + 2], { color: C.maroon, size: 17 });
      r.mathLabel('x\u209C', [xt[0] - 18, xt[1] + 2], { color: C.maroon, size: 17 });
      r.mathLabel('x\u2081', [x1[0] - 8, x1[1] + 18], { color: C.maroon, size: 17 });

      r.tangentRay(xs, tangentTarget, 0.80 * r.scale, C.teal, 2.5, 0.8);
      r.dashedLine(xs, psiSS, C.teal, 2, 0.7);
      r.dot(psiSS, C.teal, 6);
      r.mathLabel('\u03C8\u209B,\u209B', [psiSS[0] + 18, psiSS[1] - 14], { color: C.teal, size: 17 });

      // Exact secant-conditioned ψ sweep on the simplex: ψ_s,u for u ∈ [s, t].
      const connMaxIdx = psiConnectorPts.length - 1;
      const connFloat = sweepT * connMaxIdx;
      const connIdx = Math.floor(connFloat);
      const connFrac = connFloat - connIdx;
      const connDraw = psiConnectorPts.slice(0, connIdx + 1);
      if (connIdx < connMaxIdx) {
        connDraw.push(lerp2(psiConnectorPts[connIdx], psiConnectorPts[connIdx + 1], connFrac));
      }
      r.curve(connDraw, C.teal, 2.5, 0.6);

      // Moving dot on trajectory (exact point on the cubic).
      const movPos = r.trajectoryPoint(lerp(xsParam, xtParam, sweepT));
      r.dot(movPos, C.maroon, 6, 0.8);

      // Moving ψ dot — enforce the secant condition frame-by-frame.
      const psiCur = sweepT <= 1e-6 ? psiSS : (r.psiFromSecant(xs, movPos, psiInsideFrac) || psiST);
      r.dashedLine(movPos, psiCur, C.teal, 1.5, 0.5);
      r.dot(psiCur, C.teal, 6, 0.9);

      if (sweepT > 0.85) {
        const dp = (sweepT - 0.85) / 0.15;
        r.dot(psiST, C.teal, 7, dp);
        r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] - 24, psiST[1] - 14], { color: C.teal, size: 17, opacity: dp });
      }
    }

    // Step 3: secant arrow + dashed to ψ_{s,t}
    const secT = a.e(3);
    if (secT > 0) {
      // Redraw everything from step 2 fully
      r.curve(pts, '#2e4552', 3, 1);
      r.dot(x0, C.maroon, 5); r.dot(xs, C.maroon, 5); r.dot(xt, C.maroon, 5);
      r.mathLabel('x\u2080', [x0[0] + 16, x0[1] + 4], { color: C.maroon, size: 17 });
      r.mathLabel('x\u209B', [xs[0] + 16, xs[1] + 2], { color: C.maroon, size: 17 });
      r.mathLabel('x\u209C', [xt[0] - 18, xt[1] + 2], { color: C.maroon, size: 17 });
      r.mathLabel('x\u2081', [x1[0] - 8, x1[1] + 18], { color: C.maroon, size: 17 });

      // Smooth connector curve on the simplex between the two denoisers.
      r.curve(psiConnectorPts, C.teal, 2.5, 0.6);
      r.dot(psiSS, C.teal, 6); r.dot(psiST, C.teal, 7);
      r.mathLabel('\u03C8\u209B,\u209B', [psiSS[0] + 18, psiSS[1] - 14], { color: C.teal, size: 17 });
      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] - 24, psiST[1] - 14], { color: C.teal, size: 17 });

      // Tangent fades out as we switch to the secant view (matches mean_denoiser.py).
      r.tangentRay(xs, tangentTarget, 0.80 * r.scale, C.teal, 2.5, 0.8 * (1 - secT));

      // Secant arrow from x_s to x_t
      r.arrow(xs, xt, C.maroon, 2.5, secT);

      // Keep the tangent projection at x_s and reveal the secant projection at x_t.
      r.dashedLine(xs, psiSS, C.teal, 2, 0.7);
      r.dashedLine(xt, psiST, C.teal, 2, 0.7 * secT);
    }
  }
}

// ─── D: Flow Map X_{s,t} ───
class SectionFlowMap {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._trajPts = null;
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); this._trajPts = null; }

  get trajPts() {
    if (!this._trajPts) this._trajPts = this.r.trajectoryPoints(120);
    return this._trajPts;
  }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    r.drawTriangle(1);
    r.drawVertices(1);
    r.drawVertexLabels(1);

    const pts = this.trajPts;
    const xsParam = MEAN_XS_PARAM;
    const xtParam = MEAN_XT_PARAM;
    const xs = r.trajectoryPoint(xsParam);
    const xt = r.trajectoryPoint(xtParam);
    const psiSS = r.bary(P_FOX, P_DOG, P_CAT);
    const tangentVec = r.trajectoryTangent(xsParam);
    const tangentTarget = [xs[0] + tangentVec[0], xs[1] + tangentVec[1]];
    const psiInsideFrac = chordFracForPointOnRayChord(
      xs, tangentTarget, psiSS, r.vFox, r.vDog, r.vCat, MEAN_PSI_INTERIOR_FRAC
    );
    const psiST = r.psiFromSecant(xs, xt, psiInsideFrac);

    // Always show trajectory lightly
    r.curve(pts, C.ink, 2, 0.3);

    // Step 0: show flow map — convex combination
    const fmT = a.e(0);
    if (fmT > 0) {
      r.dot(xs, C.maroon, 6, fmT);
      r.mathLabel('x\u209B', [xs[0] + 16, xs[1] + 2], { color: C.maroon, size: 17, opacity: fmT });

      r.dot(psiST, C.teal, 7, fmT);
      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] - 24, psiST[1] - 14], { color: C.teal, size: 17, opacity: fmT });

      // Draw the secant line from xs through xt to psiST on the simplex
      r.dashedLine(xs, psiST, C.cloud, 1.5, fmT * 0.4);

      // X_{s,t} = xt lies on this line — show it as the convex combination
      // Example coefficient for the illustrated (x_s, x_t) pair.
      r.dot(xt, C.gold, 7, fmT);
      r.mathLabel('X\u209B,\u209C', [xt[0] + 18, xt[1] - 12], { color: C.gold, size: 18, opacity: fmT });

      // Show that xt sits on the line between xs and psiST
      r.curve([xs, psiST], C.cloud, 1.5, 0.25 * fmT);
    }

    // Step 1: animate the interpolation
    const intT = a.e(1);
    if (intT > 0) {
      r.dot(xs, C.maroon, 6);
      r.dot(psiST, C.teal, 7);
      r.mathLabel('x\u209B', [xs[0] + 16, xs[1] + 2], { color: C.maroon, size: 17 });
      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] - 24, psiST[1] - 14], { color: C.teal, size: 17 });

      // Line from xs to psiST
      r.curve([xs, psiST], C.cloud, 1.5, 0.3);

      // Moving dot along the interpolation line between xs and psiST
      const pingPong = (Math.sin(performance.now() / 1500) + 1) / 2;
      const beta = lerp(0.1, 0.9, pingPong);
      const movPos = lerp2(xs, psiST, beta);
      r.dot(movPos, C.gold, 6, intT);

      // Show xt on the line
      r.dot(xt, C.maroon, 5, intT * 0.7);
      r.mathLabel('x\u209C', [xt[0] - 16, xt[1] + 2], { color: C.maroon, size: 16, opacity: intT * 0.5 });
    }
  }
}

// ─── Helper: draw common simplex + trajectory + loss geometry ───
function drawLossBase(r, pts) {
  r.drawTriangle(1);
  r.drawVertices(1);
  r.drawVertexLabels(1);
  r.curve(pts, C.ink, 2, 0.25);

  const xsParam = LOSS_S_PARAM;
  const xuParam = LOSS_U_PARAM;
  const xtParam = LOSS_T_PARAM;
  const xsIdx = trajIdxFromParam(pts, xsParam);
  const xuIdx = trajIdxFromParam(pts, xuParam);
  const xtIdx = trajIdxFromParam(pts, xtParam);

  const xs = r.trajectoryPoint(xsParam);
  const xu = r.trajectoryPoint(xuParam);
  const xt = r.trajectoryPoint(xtParam);

  // Compute interior fraction using the same tangent-based approach as the
  // mean denoiser section, so ψ points sit inside the simplex consistently.
  const psiSS = r.bary(P_FOX, P_DOG, P_CAT);
  const tanVec = r.trajectoryTangent(xsParam);
  const tanTarget = [xs[0] + tanVec[0], xs[1] + tanVec[1]];
  const insideFrac = chordFracForPointOnRayChord(
    xs, tanTarget, psiSS, r.vFox, r.vDog, r.vCat, MEAN_PSI_INTERIOR_FRAC
  );

  return {
    xsParam, xuParam, xtParam,
    xsIdx, xuIdx, xtIdx,
    xs, xu, xt,
    insideFrac,
  };
}

// ─── E: PSD Loss ───
class SectionPSD {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._trajPts = null;
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); this._trajPts = null; }

  get trajPts() {
    if (!this._trajPts) this._trajPts = this.r.trajectoryPoints(120);
    return this._trajPts;
  }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const pts = this.trajPts;
    const { xs, xu, xt, insideFrac } = drawLossBase(r, pts);
    const psiSU = r.psiFromSecant(xs, xu, insideFrac);
    const psiUT = r.psiFromSecant(xu, xt, insideFrac);
    const psiST = r.psiFromSecant(xs, xt, insideFrac);

    // Step 0: show s, u, t points and simplex projections
    const t0 = a.e(0);
    if (t0 > 0) {
      r.dot(xs, C.maroon, 5, t0); r.dot(xu, C.maroon, 5, t0); r.dot(xt, C.maroon, 5, t0);
      r.mathLabel('x\u209B', [xs[0] + 14, xs[1] + 4], { color: C.maroon, size: 16, opacity: t0 });
      r.mathLabel('x\u1D64', [xu[0] + 14, xu[1] + 4], { color: C.maroon, size: 16, opacity: t0 });
      r.mathLabel('x\u209C', [xt[0] - 16, xt[1] + 4], { color: C.maroon, size: 16, opacity: t0 });

      // Secant lines from trajectory to simplex
      r.dashedLine(xs, psiSU, C.teal, 1.5, t0 * 0.5);
      r.dashedLine(xu, psiUT, C.green2, 1.5, t0 * 0.5);
      r.dot(psiSU, C.teal, 5, t0);
      r.dot(psiUT, C.green2, 5, t0);
      r.mathLabel('\u03C8\u209B,\u1D64', [psiSU[0] + 16, psiSU[1] - 12], { color: C.teal, size: 16, opacity: t0 });
      r.mathLabel('\u03C8\u1D64,\u209C', [psiUT[0] + 16, psiUT[1] - 12], { color: C.green2, size: 16, opacity: t0 });
    }

    // Step 1: show convex combination -> psi_{s,t}
    const t1 = a.e(1);
    if (t1 > 0) {
      // Draw everything from step 0
      r.dot(xs, C.maroon, 5); r.dot(xu, C.maroon, 5); r.dot(xt, C.maroon, 5);
      r.dashedLine(xs, psiSU, C.teal, 1.5, 0.5);
      r.dashedLine(xu, psiUT, C.green2, 1.5, 0.5);
      r.dot(psiSU, C.teal, 5); r.dot(psiUT, C.green2, 5);

      // Line from psiSU to psiUT on the simplex
      r.curve([psiSU, psiUT], C.cloud, 1.5, 0.4 * t1);

      // psi_{s,t} = convex combination of psiSU and psiUT, on the simplex
      r.dot(psiST, C.gold, 7, t1);
      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0], psiST[1] - 16], { color: C.gold, size: 17, opacity: t1 });

      // Secant from xs through xt to psiST
      r.dashedLine(xs, psiST, C.gold, 1.5, 0.3 * t1);
    }
  }
}

// ─── F: LSD Loss ───
class SectionLSD {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._trajPts = null;
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); this._trajPts = null; }

  get trajPts() {
    if (!this._trajPts) this._trajPts = this.r.trajectoryPoints(120);
    return this._trajPts;
  }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const pts = this.trajPts;
    const { xs, xt, xsIdx, xtIdx, xtParam, insideFrac } = drawLossBase(r, pts);
    const psiST = r.psiFromSecant(xs, xt, insideFrac);
    // ψ_{t,t} — instantaneous denoiser at xt, computed from tangent direction
    const xtTan = r.trajectoryTangent(xtParam);
    const psiTT = r.psiFromSecant(xt, [xt[0] + xtTan[0], xt[1] + xtTan[1]], insideFrac);

    // Step 0: show endpoint and Lagrangian identity
    const t0 = a.e(0);
    if (t0 > 0) {
      r.dot(xs, C.maroon, 5, t0);
      r.dot(xt, C.maroon, 5, t0);
      r.mathLabel('x\u209B', [xs[0] + 14, xs[1] + 4], { color: C.maroon, size: 16, opacity: t0 });
      r.mathLabel('x\u209C', [xt[0] - 16, xt[1] + 4], { color: C.maroon, size: 16, opacity: t0 });

      // Show trajectory from xs to xt highlighted
      r.curve(pts.slice(xsIdx, xtIdx + 1), C.maroon, 2.5, 0.6 * t0);

      // ψ_{t,t} — instantaneous denoiser at xt (tangent projection)
      r.dashedLine(xt, psiTT, C.teal, 1.5, 0.5 * t0);
      r.dot(psiTT, C.teal, 6, t0);
      r.mathLabel('\u03C8\u209C,\u209C', [psiTT[0] + 18, psiTT[1] - 12], { color: C.teal, size: 16, opacity: t0 });

      // ψ_{s,t} from secant xs→xt
      r.dashedLine(xs, psiST, C.cloud, 1.5, 0.3 * t0);
      r.dot(psiST, C.gold, 6, t0);
      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] - 20, psiST[1] - 14], { color: C.gold, size: 16, opacity: t0 });

      // Arrow from psiTT to psiST (the correction term)
      r.arrow(psiTT, psiST, C.cloud, 1.5, t0 * 0.5);
    }

    // Step 1: logit space target
    const t1 = a.e(1);
    if (t1 > 0) {
      r.dot(xs, C.maroon, 5); r.dot(xt, C.maroon, 5);
      r.dot(psiTT, C.teal, 6); r.dot(psiST, C.gold, 6);

      // Highlight the target distribution with a glow
      const glow = 0.15 + 0.1 * Math.sin(performance.now() / 800);
      r.dot(psiST, C.gold, 14, glow * t1);
      r.mathLabel('Softmax target', [psiST[0], psiST[1] + 22], { color: C.gold, size: 15, opacity: t1, italic: false });
    }
  }
}

// ─── G: ESD Loss ───
class SectionESD {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._trajPts = null;
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); this._trajPts = null; }

  get trajPts() {
    if (!this._trajPts) this._trajPts = this.r.trajectoryPoints(120);
    return this._trajPts;
  }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const pts = this.trajPts;
    const { xs, xt, xsIdx, xtIdx, xsParam, insideFrac } = drawLossBase(r, pts);
    const psiST = r.psiFromSecant(xs, xt, insideFrac);
    // ψ_{s,s} from tangent at xs
    const xsTan = r.trajectoryTangent(xsParam);
    const psiSS = r.psiFromSecant(xs, [xs[0] + xsTan[0], xs[1] + xsTan[1]], insideFrac);

    // Step 0: show Eulerian invariance — two source times
    const t0 = a.e(0);
    if (t0 > 0) {
      // Two starting points on the trajectory
      const xs2Idx = trajIdxFromParam(pts, LOSS_S2_PARAM);
      const xs2 = r.trajectoryPoint(LOSS_S2_PARAM);
      const psiS2T = r.psiFromSecant(xs2, xt, insideFrac);

      r.dot(xs, C.maroon, 5, t0);
      r.dot(xs2, C.maroon, 5, t0 * 0.7);
      r.dot(xt, C.maroon, 5, t0);

      r.mathLabel('x\u209B', [xs[0] + 14, xs[1] + 4], { color: C.maroon, size: 16, opacity: t0 });
      r.mathLabel("x\u209B'", [xs2[0] + 14, xs2[1] + 10], { color: C.maroon, size: 16, opacity: t0 * 0.7 });
      r.mathLabel('x\u209C', [xt[0] - 16, xt[1] + 4], { color: C.maroon, size: 16, opacity: t0 });

      // Both project to similar psi on simplex (invariance)
      r.dashedLine(xs, psiST, C.teal, 1.5, 0.4 * t0);
      r.dashedLine(xs2, psiS2T, C.teal, 1.5, 0.3 * t0);

      r.dot(psiST, C.teal, 6, t0);
      r.dot(psiS2T, C.teal, 5, t0 * 0.7);

      // Show they converge to same endpoint
      r.curve([psiS2T, psiST], C.teal, 2, 0.4 * t0);

      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] + 18, psiST[1] - 12], { color: C.teal, size: 16, opacity: t0 });

      // ψ_{s,s} for Eulerian identity
      r.dashedLine(xs, psiSS, C.cloud, 1.5, 0.3 * t0);
      r.dot(psiSS, C.cloud, 5, t0 * 0.5);
      r.mathLabel('\u03C8\u209B,\u209B', [psiSS[0] + 18, psiSS[1] + 10], { color: C.cloud, size: 15, opacity: t0 * 0.5 });
    }

    // Step 1: logit space
    const t1 = a.e(1);
    if (t1 > 0) {
      r.dot(xs, C.maroon, 5); r.dot(xt, C.maroon, 5);
      r.dot(psiST, C.teal, 6); r.dot(psiSS, C.cloud, 5, 0.5);

      const glow = 0.15 + 0.1 * Math.sin(performance.now() / 800);
      r.dot(psiST, C.teal, 14, glow * t1);
      r.mathLabel('\u03C8\u209B,\u209C', [psiST[0] + 18, psiST[1] - 12], { color: C.teal, size: 16, opacity: t1 });
    }
  }
}

// ─── H: dPSD Loss ───
class SectionDPSD {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._trajPts = null;
  }
  setStep(s) { this.a.setStep(s); }
  resize() { this.r.resize(); this._trajPts = null; }

  get trajPts() {
    if (!this._trajPts) this._trajPts = this.r.trajectoryPoints(120);
    return this._trajPts;
  }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const pts = this.trajPts;
    const { xs, xu, xt, insideFrac } = drawLossBase(r, pts);
    const psiSU = r.psiFromSecant(xs, xu, insideFrac);
    const psiUT = r.psiFromSecant(xu, xt, insideFrac);
    const psiST = r.psiFromSecant(xs, xt, insideFrac);

    const t0 = a.e(0);
    if (t0 > 0) {
      r.dot(xs, C.maroon, 5, t0); r.dot(xu, C.maroon, 5, t0); r.dot(xt, C.maroon, 5, t0);
      r.mathLabel('x\u209B', [xs[0] + 14, xs[1] + 4], { color: C.maroon, size: 16, opacity: t0 });
      r.mathLabel('x\u1D64', [xu[0] + 14, xu[1] + 4], { color: C.maroon, size: 16, opacity: t0 });
      r.mathLabel('x\u209C', [xt[0] - 16, xt[1] + 4], { color: C.maroon, size: 16, opacity: t0 });

      r.dot(psiSU, C.teal, 5, t0);
      r.dot(psiUT, C.green2, 5, t0);
      r.dot(psiST, C.gold, 6, t0);

      // Convex combination line
      r.curve([psiSU, psiUT], C.cloud, 1.5, 0.4 * t0);

      // Small perturbation arrow at u
      const eps = 8;
      const perturb = [xu[0] + eps, xu[1] - eps * 0.5];
      r.arrow(xu, perturb, C.gold, 1.5, t0 * 0.6);

      // d/du = 0 visualization: the convex combination is constant
      const alpha0 = 0.55;
      const target = lerp2(psiSU, psiUT, 1 - alpha0);
      r.dot(target, C.gold, 5, t0 * 0.5);

      // Animated oscillation to show invariance under u
      const osc = Math.sin(performance.now() / 1200) * 0.12;
      const a2 = alpha0 + osc;
      const oscTarget = lerp2(psiSU, psiUT, 1 - a2);
      r.dot(oscTarget, C.gold, 7, t0);

      r.mathLabel('d/du = 0', [psiST[0], psiST[1] + 22], { color: C.gold, size: 16, opacity: t0, italic: false });
    }
  }
}

// ─── Parallel Generation ───

// Word grid: each position in the sentence has 3 options (one per vertex).
// Any combination of vertex choices produces a grammatically correct sentence.
const SENTENCE_BANKS = [
  // Each bank is an array of L=8 positions, each with [left, top, right] words
  [['the','a','one'],  ['quick','small','bold'],   ['fox','cat','dog'],  ['can','will','may'],
   ['swiftly','softly','boldly'], ['jump','dance','sing'], ['over','through','past'], ['fences','clouds','dreams']],
  [['the','a','one'],  ['lazy','brave','wise'],    ['bird','frog','bear'], ['could','shall','might'],
   ['gently','proudly','gladly'], ['soar','leap','rest'],  ['above','across','beyond'], ['rivers','mountains','stars']],
  [['the','a','one'],  ['bright','calm','fierce'], ['owl','wolf','deer'], ['would','should','must'],
   ['slowly','warmly','freely'], ['roam','glow','drift'], ['under','along','among'], ['trees','waves','stones']],
];

class SectionParallel {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this.L = 8;
    this._pickSentence();
    this._replayHover = false;
    this._replayBounds = null; // {x,y,w,h} in CSS pixels

    // Click handler for replay button
    canvas.style.cursor = 'default';
    canvas.addEventListener('click', (e) => {
      if (!this._replayBounds) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const b = this._replayBounds;
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        this._replay();
      }
    });

    // Hover detection for cursor change
    canvas.addEventListener('mousemove', (e) => {
      if (!this._replayBounds) { canvas.style.cursor = 'default'; return; }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const b = this._replayBounds;
      const over = mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
      this._replayHover = over;
      canvas.style.cursor = over ? 'pointer' : 'default';
    });
  }

  _pickSentence() {
    this.bank = SENTENCE_BANKS[Math.floor(Math.random() * SENTENCE_BANKS.length)];
    this.targets = Array.from({ length: this.L }, () => Math.floor(Math.random() * 3));
    this.noiseY = Array.from({ length: this.L }, () => (Math.random() - 0.5) * 0.3);
  }

  _replay() {
    this._pickSentence();
    // Reset animation: clear all progress, then re-trigger step sequence
    this.a.progress = {};
    this.a.step = -1;
    // Kick off step 0 immediately, step 1 after a short delay
    this.a.setStep(0);
    setTimeout(() => this.a.setStep(1), 400);
  }

  setStep(s) {
    if (s === 0) this._pickSentence();
    this.a.setStep(s);
  }
  resize() { this.r.resize(); }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const t0 = a.e(0);
    const t1 = a.e(1);
    if (t0 <= 0) return;

    const spacing = r.w / (this.L + 1);
    const miniScale = Math.min(spacing * 0.35, r.h * 0.12);
    const wordSize = Math.max(8, Math.min(11, miniScale * 0.22));

    for (let i = 0; i < this.L; i++) {
      const cx = spacing * (i + 1);
      const cy = r.h * 0.42;

      // Mini simplex vertices
      const vTop  = [cx, cy - miniScale * 1.1];
      const vLeft = [cx - miniScale, cy + miniScale * 0.6];
      const vRight= [cx + miniScale, cy + miniScale * 0.6];
      const verts = [vLeft, vTop, vRight];

      // Draw mini triangle
      const ctx = r.ctx;
      ctx.save();
      ctx.globalAlpha = t0 * 0.4;
      ctx.beginPath();
      ctx.moveTo(...vLeft); ctx.lineTo(...vTop); ctx.lineTo(...vRight); ctx.closePath();
      ctx.fillStyle = C.simplexFill;
      ctx.fill();
      ctx.globalAlpha = t0;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Vertex dots & word labels
      const colors = [C.green1, C.green2, C.green3];
      const words = this.bank[i]; // [left, top, right]
      const landed = t1 >= 1;
      const targetV = this.targets[i];

      for (let v = 0; v < 3; v++) {
        r.dot(verts[v], colors[v], 3, t0);
      }

      // Draw only the target word, centered below the triangle
      {
        const isLanded = t1 >= 1;
        const wordOpacity = isLanded ? 1 : (t1 > 0 ? 0.3 + 0.7 * t1 : 0.4);
        const labelY = vLeft[1] + miniScale * 0.45;

        ctx.save();
        ctx.globalAlpha = t0 * wordOpacity;
        ctx.font = `${isLanded ? 'bold ' : ''}${wordSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = isLanded ? colors[targetV] : C.cloud;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(words[targetV], cx, labelY);
        ctx.restore();
      }

      // Noise point below
      const noiseY = cy + miniScale * 2.5 + this.noiseY[i] * miniScale;
      const noisePos = [cx, noiseY];

      if (t1 > 0) {
        // Animate flow from noise to target vertex
        const target = verts[targetV];
        const flowT = clamp(t1 * 1.5 - i * 0.08, 0, 1);
        const ft = easeInOut(flowT);

        const curPos = lerp2(noisePos, target, ft);

        // Trail
        ctx.save();
        ctx.globalAlpha = 0.25 * t1;
        ctx.beginPath();
        ctx.moveTo(...noisePos);
        const mid = [lerp(noisePos[0], target[0], 0.5) + (i % 2 ? 10 : -10),
                      lerp(noisePos[1], target[1], 0.5)];
        ctx.quadraticCurveTo(...mid, ...curPos);
        ctx.strokeStyle = colors[targetV];
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        r.dot(curPos, colors[targetV], 4, t1);

        // Landing glow when arrived
        if (ft > 0.95) {
          const glow = 0.25 + 0.12 * Math.sin(performance.now() / 500);
          r.dot(target, colors[targetV], miniScale * 0.25, glow);
        }
      } else {
        r.dot(noisePos, C.cloud, 3, t0 * 0.6);
      }
    }

    // Assembled sentence below the simplexes
    if (t1 > 0.3) {
      const sentenceY = r.h * 0.82;
      const sentence = this.targets.map((v, i) => this.bank[i][v]).join(' ');
      const sentOpacity = clamp((t1 - 0.3) * 2, 0, 1);

      const ctx = r.ctx;
      ctx.save();
      ctx.globalAlpha = sentOpacity;
      ctx.font = `italic ${Math.max(13, miniScale * 0.32)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`"${sentence}"`, r.w / 2, sentenceY);
      ctx.restore();

      // ── Replay button: abstracted green simplex icon with circular arrow ──
      if (sentOpacity > 0.5) {
        const btnOpacity = clamp((sentOpacity - 0.5) * 2, 0, 1);
        const hover = this._replayHover;
        const ctx2 = r.ctx;

        // Measure sentence width with matching font
        ctx2.save();
        ctx2.font = `italic ${Math.max(13, miniScale * 0.32)}px Inter, system-ui, sans-serif`;
        const sentW = ctx2.measureText(`"${sentence}"`).width;
        ctx2.restore();

        // Button position: right of the sentence
        const btnSize = Math.max(18, miniScale * 0.38);
        const btnX = r.w / 2 + sentW / 2 + btnSize * 1.2;
        const btnY = sentenceY;

        // Store bounds in CSS pixels for hit-testing
        this._replayBounds = {
          x: btnX - btnSize * 1.1,
          y: btnY - btnSize * 1.1,
          w: btnSize * 2.2,
          h: btnSize * 2.2,
        };

        const scale = hover ? 1.12 : 1;

        ctx2.save();
        ctx2.translate(btnX, btnY);
        ctx2.scale(scale, scale);
        ctx2.globalAlpha = btnOpacity * (hover ? 1 : 0.6);

        // Mini simplex triangle
        const s = btnSize * 0.55;
        ctx2.beginPath();
        ctx2.moveTo(0, -s * 0.9);          // top
        ctx2.lineTo(-s * 0.85, s * 0.5);   // bottom-left
        ctx2.lineTo(s * 0.85, s * 0.5);    // bottom-right
        ctx2.closePath();
        ctx2.fillStyle = C.green1;
        ctx2.globalAlpha = btnOpacity * (hover ? 0.18 : 0.1);
        ctx2.fill();
        ctx2.globalAlpha = btnOpacity * (hover ? 1 : 0.6);
        ctx2.strokeStyle = C.green1;
        ctx2.lineWidth = 1.5;
        ctx2.stroke();

        // Circular refresh arrow around the simplex
        const arcR = s * 1.2;
        ctx2.beginPath();
        ctx2.arc(0, 0, arcR, -0.6, Math.PI * 1.4, false);
        ctx2.strokeStyle = C.green1;
        ctx2.lineWidth = 1.8;
        ctx2.lineCap = 'round';
        ctx2.stroke();

        // Arrowhead at end of arc
        const aEnd = Math.PI * 1.4;
        const ax = Math.cos(aEnd) * arcR;
        const ay = Math.sin(aEnd) * arcR;
        const aLen = s * 0.4;
        ctx2.beginPath();
        ctx2.moveTo(ax + aLen * Math.cos(aEnd - 0.5), ay + aLen * Math.sin(aEnd - 0.5));
        ctx2.lineTo(ax, ay);
        ctx2.lineTo(ax + aLen * Math.cos(aEnd + 1.3), ay + aLen * Math.sin(aEnd + 1.3));
        ctx2.strokeStyle = C.green1;
        ctx2.lineWidth = 1.8;
        ctx2.stroke();

        ctx2.restore();
      }
    } else {
      this._replayBounds = null;
    }
  }
}


// ─── Fine-tuning / Steering ───

// Arithmetic examples for steering visualization.
// Each example: array of { tokens: [left,top,right], greenTarget, redTarget }.
// Green lands on a wrong answer; red steers to the correct one.
const STEER_EXAMPLES = [
  // 12 + 7 = 19, green says 18
  [
    { tokens: ['1','7','3'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['2','8','0'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['+','−','×'], greenTarget: 0, redTarget: 0 },
    { tokens: ['7','5','9'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['=',':','→'], greenTarget: 0, redTarget: 0 },
    { tokens: ['1','2','0'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['8','9','7'],  greenTarget: 0, redTarget: 1 },  // 8→9
  ],
  // 9 × 6 = 54, green says 56
  [
    { tokens: ['9','7','3'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['×','+','−'], greenTarget: 0, redTarget: 0 },
    { tokens: ['6','4','8'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['=',':','→'], greenTarget: 0, redTarget: 0 },
    { tokens: ['5','3','6'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['6','4','8'],  greenTarget: 0, redTarget: 1 },  // 6→4
  ],
  // 45 − 18 = 27, green says 23
  [
    { tokens: ['4','2','6'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['5','8','1'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['−','+','×'], greenTarget: 0, redTarget: 0 },
    { tokens: ['1','3','2'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['8','5','0'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['=',':','→'], greenTarget: 0, redTarget: 0 },
    { tokens: ['2','3','1'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['3','7','9'],  greenTarget: 0, redTarget: 1 },  // 3→7
  ],
  // 8 × 7 = 56, green says 54
  [
    { tokens: ['8','5','3'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['×','+','−'], greenTarget: 0, redTarget: 0 },
    { tokens: ['7','9','4'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['=',':','→'], greenTarget: 0, redTarget: 0 },
    { tokens: ['5','4','6'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['4','6','8'],  greenTarget: 0, redTarget: 1 },  // 4→6
  ],
  // 25 + 37 = 62, green says 52 (carry error)
  [
    { tokens: ['2','3','1'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['5','7','9'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['+','−','×'], greenTarget: 0, redTarget: 0 },
    { tokens: ['3','2','4'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['7','5','1'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['=',':','→'], greenTarget: 0, redTarget: 0 },
    { tokens: ['5','6','4'],  greenTarget: 0, redTarget: 1 },  // 5→6
    { tokens: ['2','0','8'],  greenTarget: 0, redTarget: 0 },
  ],
  // 100 ÷ 4 = 25, green says 24
  [
    { tokens: ['1','2','0'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['0','5','8'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['0','2','6'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['÷','×','+'], greenTarget: 0, redTarget: 0 },
    { tokens: ['4','5','2'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['=',':','→'], greenTarget: 0, redTarget: 0 },
    { tokens: ['2','3','1'],  greenTarget: 0, redTarget: 0 },
    { tokens: ['4','5','8'],  greenTarget: 0, redTarget: 1 },  // 4→5
  ],
];

class SectionSteering {
  constructor(canvas) {
    this.r = new SimplexRenderer(canvas);
    this.a = new Anim();
    this._pickExample();
  }

  _pickExample() {
    this.positions = STEER_EXAMPLES[Math.floor(Math.random() * STEER_EXAMPLES.length)];
    this.L = this.positions.length;
    this.noiseY = Array.from({ length: this.L }, () => (Math.random() - 0.5) * 0.2);
  }

  setStep(s) {
    if (s === 0) this._pickExample();
    this.a.setStep(s);
  }
  resize() { this.r.resize(); }

  draw(dt) {
    this.a.tick(dt);
    const r = this.r, a = this.a;
    r.clear();

    const t0 = a.e(0);
    const t1 = a.e(1);
    if (t0 <= 0) return;

    const spacing = r.w / (this.L + 1);
    const miniScale = Math.min(spacing * 0.38, r.h * 0.11);
    const tokenSize = Math.max(9, Math.min(13, miniScale * 0.28));

    const greenColor = C.green1;
    const redColor = C.red;

    for (let i = 0; i < this.L; i++) {
      const pos = this.positions[i];
      const cx = spacing * (i + 1);
      const cy = r.h * 0.40;

      // Mini simplex vertices
      const vTop  = [cx, cy - miniScale * 1.1];
      const vLeft = [cx - miniScale, cy + miniScale * 0.6];
      const vRight= [cx + miniScale, cy + miniScale * 0.6];
      const verts = [vLeft, vTop, vRight];

      const ctx = r.ctx;

      // Draw mini triangle
      ctx.save();
      ctx.globalAlpha = t0 * 0.35;
      ctx.beginPath();
      ctx.moveTo(...vLeft); ctx.lineTo(...vTop); ctx.lineTo(...vRight); ctx.closePath();
      ctx.fillStyle = C.simplexFill;
      ctx.fill();
      ctx.globalAlpha = t0;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Vertex dots with token labels
      for (let v = 0; v < 3; v++) {
        r.dot(verts[v], C.cloud, 2.5, t0 * 0.5);

        // Token labels placed outside vertices
        const labelOffsets = [
          [verts[0][0] - miniScale * 0.15, verts[0][1] + miniScale * 0.4],  // left: below-left
          [verts[1][0], verts[1][1] - miniScale * 0.25],                      // top: above
          [verts[2][0] + miniScale * 0.15, verts[2][1] + miniScale * 0.4],  // right: below-right
        ];
        const aligns = ['center', 'center', 'center'];

        ctx.save();
        ctx.globalAlpha = t0 * 0.35;
        ctx.font = `${tokenSize * 0.85}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = C.cloud;
        ctx.textAlign = aligns[v];
        ctx.textBaseline = v === 1 ? 'bottom' : 'top';
        ctx.fillText(pos.tokens[v], labelOffsets[v][0], labelOffsets[v][1]);
        ctx.restore();
      }

      // Noise start
      const noiseY = cy + miniScale * 2.2 + this.noiseY[i] * miniScale;
      const noisePos = [cx, noiseY];

      // Green trajectory (base model) — always visible from step 0
      const greenTarget = verts[pos.greenTarget];
      const greenFlowT = clamp(t0 * 1.5 - i * 0.06, 0, 1);
      const greenFt = easeInOut(greenFlowT);
      const greenCur = lerp2(noisePos, greenTarget, greenFt);

      // Green trail
      ctx.save();
      ctx.globalAlpha = 0.25 * t0;
      ctx.beginPath();
      ctx.moveTo(...noisePos);
      const gMid = [lerp(noisePos[0], greenTarget[0], 0.5) + (i % 2 ? 8 : -8),
                    lerp(noisePos[1], greenTarget[1], 0.5)];
      ctx.quadraticCurveTo(...gMid, ...greenCur);
      ctx.strokeStyle = greenColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      r.dot(greenCur, greenColor, 3.5, t0);

      // Green landing highlight
      if (greenFt > 0.95) {
        r.dot(greenTarget, greenColor, 5, 0.3 * t0);

        // Highlight the landed token in green
        const labelPos = [
          [verts[0][0] - miniScale * 0.15, verts[0][1] + miniScale * 0.4],
          [verts[1][0], verts[1][1] - miniScale * 0.25],
          [verts[2][0] + miniScale * 0.15, verts[2][1] + miniScale * 0.4],
        ][pos.greenTarget];

        ctx.save();
        ctx.globalAlpha = t0 * (t1 > 0 ? 0.4 : 0.9);
        ctx.font = `bold ${tokenSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = greenColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = pos.greenTarget === 1 ? 'bottom' : 'top';
        ctx.fillText(pos.tokens[pos.greenTarget], labelPos[0], labelPos[1]);
        ctx.restore();
      }

      // Red trajectory (steered) — appears in step 1
      if (t1 > 0) {
        const redTarget = verts[pos.redTarget];
        const redFlowT = clamp(t1 * 1.5 - i * 0.06, 0, 1);
        const redFt = easeInOut(redFlowT);

        // Red starts from same noise but diverges partway
        const divergeT = 0.4;
        let redCur;
        if (redFt < divergeT) {
          // Follows green path initially
          redCur = lerp2(noisePos, greenTarget, redFt);
        } else {
          // Diverges toward red target
          const divergePos = lerp2(noisePos, greenTarget, divergeT);
          const localT = (redFt - divergeT) / (1 - divergeT);
          redCur = lerp2(divergePos, redTarget, easeInOut(localT));
        }

        // Red trail
        const divergePos = lerp2(noisePos, greenTarget, divergeT);
        ctx.save();
        ctx.globalAlpha = 0.3 * t1;
        ctx.beginPath();
        ctx.moveTo(...divergePos);
        const rMid = [lerp(divergePos[0], redTarget[0], 0.5) + (i % 2 ? -6 : 6),
                      lerp(divergePos[1], redTarget[1], 0.5)];
        const rEnd = redFt >= 1 ? redTarget : redCur;
        ctx.quadraticCurveTo(...rMid, ...rEnd);
        ctx.strokeStyle = redColor;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();

        r.dot(redCur, redColor, 4, t1);

        // Red landing highlight
        if (redFt > 0.95) {
          const glow = 0.2 + 0.1 * Math.sin(performance.now() / 400);
          r.dot(redTarget, redColor, miniScale * 0.22, glow);

          // Highlight the landed token in red
          const labelPos = [
            [verts[0][0] - miniScale * 0.15, verts[0][1] + miniScale * 0.4],
            [verts[1][0], verts[1][1] - miniScale * 0.25],
            [verts[2][0] + miniScale * 0.15, verts[2][1] + miniScale * 0.4],
          ][pos.redTarget];

          ctx.save();
          ctx.globalAlpha = t1;
          ctx.font = `bold ${tokenSize}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = redColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = pos.redTarget === 1 ? 'bottom' : 'top';
          ctx.fillText(pos.tokens[pos.redTarget], labelPos[0], labelPos[1]);
          ctx.restore();
        }
      }
    }

    // Assembled answer strings below
    const answerY = r.h * 0.78;
    const ctx2 = r.ctx;

    // Green answer (base)
    if (t0 > 0.5) {
      const greenAnswer = this.positions.map(p => p.tokens[p.greenTarget]).join(' ');
      const go = clamp((t0 - 0.5) * 2, 0, 1);
      const fadeGreen = t1 > 0 ? Math.max(0.35, 1 - t1 * 0.65) : 1;

      ctx2.save();
      ctx2.globalAlpha = go * fadeGreen;
      ctx2.font = `${Math.max(12, miniScale * 0.3)}px Inter, system-ui, sans-serif`;
      ctx2.fillStyle = greenColor;
      ctx2.textAlign = 'center';
      ctx2.textBaseline = 'middle';
      // Strikethrough for wrong answer when red appears
      const text = greenAnswer;
      ctx2.fillText(text, r.w / 2, answerY);
      if (t1 > 0.5) {
        const tw = ctx2.measureText(text).width;
        ctx2.strokeStyle = redColor;
        ctx2.lineWidth = 1.5;
        ctx2.globalAlpha = go * clamp((t1 - 0.5) * 2, 0, 1) * 0.6;
        ctx2.beginPath();
        ctx2.moveTo(r.w / 2 - tw / 2 - 4, answerY);
        ctx2.lineTo(r.w / 2 + tw / 2 + 4, answerY);
        ctx2.stroke();
      }
      ctx2.restore();
    }

    // Red answer (steered)
    if (t1 > 0.5) {
      const redAnswer = this.positions.map(p => p.tokens[p.redTarget]).join(' ');
      const ro = clamp((t1 - 0.5) * 2, 0, 1);

      ctx2.save();
      ctx2.globalAlpha = ro;
      ctx2.font = `bold ${Math.max(13, miniScale * 0.34)}px Inter, system-ui, sans-serif`;
      ctx2.fillStyle = redColor;
      ctx2.textAlign = 'center';
      ctx2.textBaseline = 'middle';
      ctx2.fillText(redAnswer, r.w / 2, answerY + Math.max(18, miniScale * 0.5));
      ctx2.restore();
    }
  }
}


// ════════════════════════════════════════════════════════════
//  SCROLL OBSERVER
// ════════════════════════════════════════════════════════════
function initScrollObserver(sections) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const stepEl = entry.target;
      const sectionEl = stepEl.closest('.scroll-section');
      if (!sectionEl) return;
      const sectionName = sectionEl.dataset.section;
      const stepIdx = parseInt(stepEl.dataset.step, 10);
      const section = sections.get(sectionName);
      if (!section) return;

      // Update active step CSS class
      section.steps.forEach(s => s.classList.remove('is-active'));
      stepEl.classList.add('is-active');

      // Tell controller
      section.controller.setStep(stepIdx);
    });
  }, {
    root: null,
    threshold: 0.1,
    rootMargin: '-35% 0px -35% 0px',
  });

  sections.forEach(({ steps }) => {
    steps.forEach(step => observer.observe(step));
  });

  return observer;
}


// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // KaTeX auto-render
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(document.body, {
      delimiters: [
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
    });
  }

  // Section configs: [data-section name, Controller class, canvas ID]
  const configs = [
    ['simplex',       SectionSimplex,       'canvas-simplex'],
    ['denoiser-inst', SectionDenoiserInst,  'canvas-denoiser-inst'],
    ['mean-denoiser', SectionMeanDenoiser,  'canvas-mean-denoiser'],
    ['flow-map',      SectionFlowMap,       'canvas-flow-map'],
    ['psd',           SectionPSD,           'canvas-psd'],
    ['lsd',           SectionLSD,           'canvas-lsd'],
    ['esd',           SectionESD,           'canvas-esd'],
    ['dpsd',          SectionDPSD,          'canvas-dpsd'],
    ['parallel',      SectionParallel,      'canvas-parallel'],
    ['steering',      SectionSteering,      'canvas-steering'],
  ];

  const sections = new Map();

  for (const [name, Ctrl, canvasId] of configs) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) continue;
    const sectionEl = document.querySelector(`[data-section="${name}"]`);
    if (!sectionEl) continue;
    const steps = sectionEl.querySelectorAll('.scroll-step');
    const controller = new Ctrl(canvas);
    sections.set(name, { controller, steps });
  }

  initScrollObserver(sections);

  // Handle resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sections.forEach(({ controller }) => controller.resize());
    }, 150);
  });

  // Animation loop
  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    sections.forEach(({ controller }) => {
      controller.draw(dt);
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
