// Stochastic interpolant: sample (x0, x1) ~ rho_0 x rho_1, draw straight
// lines I_t = (1-t) x0 + t x1, and at a fixed query point (t*, x*) average
// the slopes of every interpolant that passes through it — the closed-form
// b_t(x) = E[dI_t | I_t = x].
//
// Self-mounts on <canvas id="anim-interpolant"> inside #stage-interpolant.

(function () {
  const canvas = document.getElementById('anim-interpolant');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage-interpolant');
  stage.style.position = 'relative';

  // ---------- mixture spec (same as dynamical-transport) ----------
  const SIGMA0 = 0.55;
  const MIX = [
    { pi: 0.14, mu: -2.20, sg: 0.12 },
    { pi: 0.10, mu: -1.05, sg: 0.32 },
    { pi: 0.22, mu: -0.50, sg: 0.28 },
    { pi: 0.18, mu:  0.55, sg: 0.10 },
    { pi: 0.16, mu:  1.20, sg: 0.30 },
    { pi: 0.12, mu:  1.75, sg: 0.26 },
    { pi: 0.08, mu:  2.70, sg: 0.11 },
  ];
  const TMIN = 0.0, TMAX = 1.0;
  const X_RANGE = 3.3;

  function gaussPdf(x, mu, varc) {
    const d = x - mu;
    return Math.exp(-0.5 * d * d / varc) / Math.sqrt(2 * Math.PI * varc);
  }
  function velocity(x, t) {
    let num = 0, den = 0;
    for (const c of MIX) {
      const Vk = (1 - t) * (1 - t) * SIGMA0 * SIGMA0 + t * t * c.sg * c.sg;
      const pk = c.pi * gaussPdf(x, t * c.mu, Vk);
      const coef = (t * c.sg * c.sg - (1 - t) * SIGMA0 * SIGMA0) / Vk;
      const mk = c.mu + coef * (x - t * c.mu);
      num += pk * mk;
      den += pk;
    }
    return den === 0 ? 0 : num / den;
  }

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randn(rng) {
    const u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function sampleMix(rng) {
    let r = rng(), acc = 0;
    for (const c of MIX) { acc += c.pi; if (r < acc) return c.mu + c.sg * randn(rng); }
    const c = MIX[MIX.length - 1];
    return c.mu + c.sg * randn(rng);
  }

  // ---------- sample pairs ----------
  const N_PAIRS = 140;
  const rng = mulberry32(23);
  const pairs = [];
  for (let i = 0; i < N_PAIRS; i++) {
    pairs.push({ x0: SIGMA0 * randn(rng), x1: sampleMix(rng) });
  }

  // query point and which lines pass through it (within tolerance)
  const TQ = 0.42, XQ = 0.30, EPS = 0.06;
  const through = pairs.filter(p => Math.abs((1 - TQ) * p.x0 + TQ * p.x1 - XQ) < EPS);
  const bQ = velocity(XQ, TQ);

  // density profiles for the edge curtains
  function densityRho0(x) { return gaussPdf(x, 0, SIGMA0 * SIGMA0); }
  function densityRho1(x) {
    let s = 0;
    for (const c of MIX) s += c.pi * gaussPdf(x, c.mu, c.sg * c.sg);
    return s;
  }
  const N_DEN = 220;
  const denX = new Float32Array(N_DEN);
  const denRho0 = new Float32Array(N_DEN);
  const denRho1 = new Float32Array(N_DEN);
  let maxRho = 0;
  for (let i = 0; i < N_DEN; i++) {
    const x = -X_RANGE + (2 * X_RANGE) * (i / (N_DEN - 1));
    denX[i] = x;
    denRho0[i] = densityRho0(x);
    denRho1[i] = densityRho1(x);
    if (denRho0[i] > maxRho) maxRho = denRho0[i];
    if (denRho1[i] > maxRho) maxRho = denRho1[i];
  }

  // ---------- KaTeX overlay labels ----------
  function mkLabel(tex, opts) {
    opts = opts || {};
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.left = '0px'; el.style.top = '0px';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.whiteSpace = 'nowrap';
    el.style.pointerEvents = 'none';
    el.style.fontSize = (opts.size || 15) + 'px';
    el.style.color = opts.color || 'rgba(40,40,40,0.9)';
    el.dataset.tex = tex;
    el.textContent = '$' + tex + '$';
    stage.appendChild(el);
    return el;
  }
  const L = {
    rho0: mkLabel('\\rho_0', { size: 16 }),
    rho1: mkLabel('\\rho_1', { size: 16 }),
    It:   mkLabel('I_t = (1{-}t)x_0 + t x_1', { size: 14, color: 'rgba(80,80,80,0.9)' }),
    q:    mkLabel('(t, x)'),
    dotI: mkLabel('\\dot I_t = x_1 - x_0', { size: 13, color: 'rgba(110,110,110,0.9)' }),
    b:    mkLabel('b_t(x) = \\mathbb{E}[\\dot I_t \\mid I_t = x]',
                  { size: 16, color: '#3858d6' }),
  };
  (function renderLabels() {
    if (window.katex && katex.render) {
      for (const k in L) katex.render(L[k].dataset.tex, L[k], { throwOnError: false });
    } else setTimeout(renderLabels, 30);
  })();
  function place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; }

  // ---------- canvas / layout ----------
  const DPR = window.devicePixelRatio || 1;
  function resize() {
    const cssW = stage.clientWidth;
    const cssH = Math.min(300, Math.max(210, cssW * 0.36));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // a fresh pair every SPAWN_MS to visualize the sampling step
  const SPAWN_MS = 650, FRESH_LIFE = 1800;
  const fresh = [];
  let lastSpawn = 0;
  const liveRng = mulberry32(101);

  function draw(time) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const padL = 80, padR = 80, padT = 16, padB = 18;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const xT = (t) => padL + (t - TMIN) / (TMAX - TMIN) * plotW;
    const yX = (x) => padT + (1 - (x + X_RANGE) / (2 * X_RANGE)) * plotH;

    // --- background interpolant lines ---
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110,110,110,0.07)';
    for (const p of pairs) {
      ctx.beginPath();
      ctx.moveTo(xT(0), yX(p.x0));
      ctx.lineTo(xT(1), yX(p.x1));
      ctx.stroke();
    }

    // --- density curtains ---
    drawDensity(denX, denRho0, padL, padT, plotH, -1);
    drawDensity(denX, denRho1, W - padR, padT, plotH, +1);
    place(L.rho0, padL - 50, padT + 14);
    place(L.rho1, W - padR + 50, padT + 14);

    // --- spawn fresh pairs to animate the sampling step ---
    if (time - lastSpawn > SPAWN_MS) {
      lastSpawn = time;
      fresh.push({ x0: SIGMA0 * randn(liveRng), x1: sampleMix(liveRng), born: time });
      while (fresh.length > 8) fresh.shift();
    }
    for (const f of fresh) {
      const age = (time - f.born) / FRESH_LIFE;
      if (age > 1) continue;
      const grow = Math.min(1, age / 0.35);          // line draws in over first 35%
      const fade = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
      const xEnd = grow;                              // draw from t=0 to t=grow
      const yEnd = (1 - xEnd) * f.x0 + xEnd * f.x1;
      // endpoints
      ctx.fillStyle = `rgba(60,60,60,${0.7 * fade})`;
      ctx.beginPath(); ctx.arc(xT(0), yX(f.x0), 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(xT(1), yX(f.x1), 3.5, 0, Math.PI * 2); ctx.fill();
      // growing line
      ctx.strokeStyle = `rgba(60,60,60,${0.55 * fade})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(xT(0), yX(f.x0));
      ctx.lineTo(xT(xEnd), yX(yEnd));
      ctx.stroke();
    }
    place(L.It, xT(0.78), padT + 10);

    // --- query point conditioning set ---
    const qx = xT(TQ), qy = yX(XQ);
    // highlight lines through (TQ, XQ)
    ctx.lineWidth = 1.4;
    for (const p of through) {
      ctx.strokeStyle = 'rgba(180,140,60,0.65)';
      ctx.beginPath();
      ctx.moveTo(xT(0), yX(p.x0));
      ctx.lineTo(xT(1), yX(p.x1));
      ctx.stroke();
    }
    // per-line slope arrows (vertical, faint grey) at the query t
    const pxPerWorldX = plotH / (2 * X_RANGE);
    const VEL_SCALE = 0.55;
    for (const p of through) {
      const slope = p.x1 - p.x0;
      drawVArrow(qx, qy, slope, pxPerWorldX, VEL_SCALE,
                 'rgba(130,130,130,0.45)', 1.6, 7);
    }
    // averaged slope = closed-form b_t(x)
    drawVArrow(qx, qy, bQ, pxPerWorldX, VEL_SCALE, '#3858d6', 3.0, 11);

    // query point marker + labels
    ctx.fillStyle = '#8a6ad6';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(qx, qy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    place(L.q, qx - 28, qy - 14);
    place(L.dotI, qx + 90, qy + 28);
    place(L.b, qx + 8 + L.b.offsetWidth / 2,
              qy - bQ * pxPerWorldX * VEL_SCALE - 34);

    requestAnimationFrame(draw);
  }

  function drawVArrow(px, py, v, pxPerX, scale, color, lw, head) {
    let dy = -v * pxPerX * scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + dy);
    ctx.stroke();
    if (Math.abs(dy) > 4) {
      const dir = Math.sign(dy);
      ctx.beginPath();
      ctx.moveTo(px, py + dy);
      ctx.lineTo(px - head * 0.55, py + dy - head * dir);
      ctx.lineTo(px + head * 0.55, py + dy - head * dir);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawDensity(xs, rho, anchorX, padT, plotH, side) {
    const BULGE = 56;
    ctx.strokeStyle = 'rgba(60,60,60,0.7)';
    ctx.fillStyle = 'rgba(60,60,60,0.06)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const sy = padT + (1 - (xs[i] + X_RANGE) / (2 * X_RANGE)) * plotH;
      const sxp = anchorX + side * (rho[i] / maxRho) * BULGE;
      if (i === 0) ctx.moveTo(sxp, sy); else ctx.lineTo(sxp, sy);
    }
    ctx.stroke();
    ctx.lineTo(anchorX, padT + plotH);
    ctx.lineTo(anchorX, padT);
    ctx.closePath();
    ctx.fill();
  }

  requestAnimationFrame(draw);
})();
