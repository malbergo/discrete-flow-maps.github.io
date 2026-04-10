// Dynamical measure transport — characteristic curves of the
// stochastic-interpolant velocity field for a Gaussian base and a
// mixture-of-Gaussians target. 1D in space, time on the horizontal axis.
//
//   I_t = (1 - t) I_0 + t I_1,    I_0 ~ N(0, sigma0^2),    I_1 ~ sum_k pi_k N(mu_k, sigma_k^2)
//
// Closed-form velocity (component-wise conditional expectation, then
// posterior-weighted across mixture components):
//
//   V_k(t) = (1-t)^2 sigma0^2 + t^2 sigma_k^2
//   m_k(x, t) = mu_k + (t sigma_k^2 - (1-t) sigma0^2) / V_k(t) * (x - t mu_k)
//   p_k(x, t) ∝ pi_k * N(x; t mu_k, V_k(t))
//   w_k(x, t) = p_k / sum_j p_j
//   b_t(x) = sum_k w_k(x, t) * m_k(x, t)
//
// Self-mounts on <canvas id="anim-dynamical-transport">.

(function () {
  const canvas = document.getElementById('anim-dynamical-transport');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // ---------- mixture spec ----------
  const SIGMA0 = 0.55;                            // base std
  const MIX = [
    { pi: 0.14, mu: -2.20, sg: 0.12 },   // sharp, isolated left
    { pi: 0.10, mu: -1.05, sg: 0.32 },   // wide, overlaps next
    { pi: 0.22, mu: -0.50, sg: 0.28 },   // wide, overlaps prev
    { pi: 0.18, mu:  0.55, sg: 0.10 },   // sharp middle spike
    { pi: 0.16, mu:  1.20, sg: 0.30 },   // wide, overlaps next
    { pi: 0.12, mu:  1.75, sg: 0.26 },   // wide, overlaps prev
    { pi: 0.08, mu:  2.70, sg: 0.11 },   // sharp, isolated right
  ];
  const TMIN = 0.0, TMAX = 1.0;
  const X_RANGE = 3.3;                            // plot y-extent: [-X_RANGE, X_RANGE]

  // ---------- math ----------
  function gaussPdf(x, mu, varc) {
    const d = x - mu;
    return Math.exp(-0.5 * d * d / varc) / Math.sqrt(2 * Math.PI * varc);
  }

  // closed-form velocity field
  function velocity(x, t) {
    let num = 0, den = 0;
    const wm = new Array(MIX.length);
    for (let k = 0; k < MIX.length; k++) {
      const c = MIX[k];
      const Vk = (1 - t) * (1 - t) * SIGMA0 * SIGMA0 + t * t * c.sg * c.sg;
      const pk = c.pi * gaussPdf(x, t * c.mu, Vk);
      const coef = (t * c.sg * c.sg - (1 - t) * SIGMA0 * SIGMA0) / Vk;
      const mk = c.mu + coef * (x - t * c.mu);
      wm[k] = { pk, mk };
      den += pk;
    }
    if (den === 0) return 0;
    for (let k = 0; k < MIX.length; k++) num += (wm[k].pk / den) * wm[k].mk;
    return num;
  }

  // RK4 step on dx/dt = b_t(x)
  function rk4(x, t, dt) {
    const k1 = velocity(x, t);
    const k2 = velocity(x + 0.5 * dt * k1, t + 0.5 * dt);
    const k3 = velocity(x + 0.5 * dt * k2, t + 0.5 * dt);
    const k4 = velocity(x + dt * k3,       t + dt);
    return x + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  }

  // a stable PRNG
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

  // ---------- precompute trajectories ----------
  const N_TRAJ = 180;
  const N_STEPS = 240;
  const dt = (TMAX - TMIN) / N_STEPS;
  const rng = mulberry32(11);
  // sample base, integrate forward
  const trajs = [];
  for (let i = 0; i < N_TRAJ; i++) {
    const x0 = SIGMA0 * randn(rng);
    const xs = new Float32Array(N_STEPS + 1);
    xs[0] = x0;
    let x = x0;
    for (let s = 0; s < N_STEPS; s++) {
      x = rk4(x, TMIN + s * dt, dt);
      xs[s + 1] = x;
    }
    trajs.push(xs);
  }

  // hero trajectory: pick one whose endpoint lands near the middle mode
  let heroIdx = 0;
  let bestErr = Infinity;
  for (let i = 0; i < trajs.length; i++) {
    const end = trajs[i][N_STEPS];
    const err = Math.abs(end - MIX[1].mu);
    if (err < bestErr) { bestErr = err; heroIdx = i; }
  }

  // density curves (left and right edges) on a fine x-grid
  function densityRho0(x) { return gaussPdf(x, 0, SIGMA0 * SIGMA0); }
  function densityRho1(x) {
    let s = 0;
    for (const c of MIX) s += c.pi * gaussPdf(x, c.mu, c.sg * c.sg);
    return s;
  }

  // sample densities for plotting
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

  // ---------- thumbnails: noise → partial → clean ----------
  const THUMBS = [
    { src: 'dfms/img/dt-flower-noise.png', t: 0.0,  label: 'x\u2080' },
    { src: 'dfms/img/dt-flower-mid.png',   t: 0.5,  label: 'x\u209B' },
    { src: 'dfms/img/dt-flower-clean.png', t: 1.0,  label: 'x\u2081' },
  ];
  for (const th of THUMBS) {
    th.img = new Image();
    th.img.src = th.src;
  }
  const THUMB_PX = 64;

  // ---------- canvas / layout ----------
  const DPR = window.devicePixelRatio || 1;
  function resize() {
    const cssW = canvas.parentElement.clientWidth;
    const cssH = Math.min(460, Math.max(340, cssW * 0.58));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function draw(time) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const padL = 90, padR = 90, padT = 24, padB = 110;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const xT = (t) => padL + (t - TMIN) / (TMAX - TMIN) * plotW;        // time → screen x
    const yX = (x) => padT + (1 - (x + X_RANGE) / (2 * X_RANGE)) * plotH; // value → screen y

    // --- background trajectories ---
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110, 110, 110, 0.10)';
    for (let i = 0; i < trajs.length; i++) {
      const xs = trajs[i];
      ctx.beginPath();
      ctx.moveTo(xT(TMIN), yX(xs[0]));
      for (let s = 1; s <= N_STEPS; s++) ctx.lineTo(xT(TMIN + s * dt), yX(xs[s]));
      ctx.stroke();
    }

    // --- density profiles at the edges ---
    drawDensity(ctx, denX, denRho0, maxRho, padL, padT, plotH, X_RANGE, -1, '\u03C1\u2080');
    drawDensity(ctx, denX, denRho1, maxRho, W - padR, padT, plotH, X_RANGE, +1, '\u03C1\u2081');

    // --- hero trajectory ---
    const hero = trajs[heroIdx];
    ctx.strokeStyle = 'rgba(20,20,20,0.95)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(xT(TMIN), yX(hero[0]));
    for (let s = 1; s <= N_STEPS; s++) ctx.lineTo(xT(TMIN + s * dt), yX(hero[s]));
    ctx.stroke();

    // --- animation parameter t ---
    const period = 5500;
    const u = ((time % period) / period);
    // ease so dot dwells at endpoints
    const tNorm = 0.5 - 0.5 * Math.cos(Math.PI * u);
    const tNow = TMIN + (TMAX - TMIN) * tNorm;
    const sIdx = tNorm * N_STEPS;
    const sLo = Math.floor(sIdx), sHi = Math.min(N_STEPS, sLo + 1);
    const frac = sIdx - sLo;
    const xNow = (1 - frac) * hero[sLo] + frac * hero[sHi];

    // --- velocity arrow at (tNow, xNow): purely vertical, length ∝ |b_t(x)| ---
    const bNow = velocity(xNow, tNow);
    const px = xT(tNow), py = yX(xNow);
    // map world-velocity to screen-pixels per time-unit (consistent with yX scale)
    const pxPerWorldX = plotH / (2 * X_RANGE);
    const VEL_SCALE = 0.70;                      // visual time-window for arrow
    let dyPx = -bNow * pxPerWorldX * VEL_SCALE;  // negative because screen-y grows downward
    const MAX_PX = plotH * 0.85;
    if (Math.abs(dyPx) > MAX_PX) dyPx = MAX_PX * Math.sign(dyPx);
    const ax = px;
    const ay = py + dyPx;

    // velocity arrow (blue, vertical)
    ctx.strokeStyle = '#3858d6';
    ctx.fillStyle = '#3858d6';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    if (Math.abs(dyPx) > 4) {
      const dir = Math.sign(dyPx);
      const HEAD = 10;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - HEAD * 0.55, ay - HEAD * dir);
      ctx.lineTo(ax + HEAD * 0.55, ay - HEAD * dir);
      ctx.closePath();
      ctx.fill();
    }

    // moving particle
    ctx.fillStyle = '#8a6ad6';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // velocity label, placed beside the arrow tip
    ctx.fillStyle = '#3858d6';
    ctx.font = '13px ui-serif, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('b\u209C(x\u209C)', ax + 8, ay);

    // moving particle label
    ctx.fillStyle = 'rgba(60,60,60,0.85)';
    ctx.font = '12px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('x\u209C', px, py - 12);

    // ----- thumbnails with dotted droplines -----
    const thumbCenterY = H - padB + 12 + THUMB_PX / 2;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(60,60,60,0.45)';
    ctx.lineWidth = 1;
    for (const th of THUMBS) {
      const sIdx2 = th.t * N_STEPS;
      const sLo2 = Math.floor(sIdx2), sHi2 = Math.min(N_STEPS, sLo2 + 1);
      const f2 = sIdx2 - sLo2;
      const xVal = (1 - f2) * hero[sLo2] + f2 * hero[sHi2];
      const cx = xT(TMIN + th.t * (TMAX - TMIN));
      const cy = yX(xVal);
      // dotted line from trajectory point down to image top
      ctx.beginPath();
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx, thumbCenterY - THUMB_PX / 2 - 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // draw thumbnails + labels
    ctx.fillStyle = 'rgba(40,40,40,0.85)';
    ctx.font = '13px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const th of THUMBS) {
      const cx = xT(TMIN + th.t * (TMAX - TMIN));
      const ix = cx - THUMB_PX / 2;
      const iy = thumbCenterY - THUMB_PX / 2;
      // small dot at trajectory anchor
      const sIdx2 = th.t * N_STEPS;
      const sLo2 = Math.floor(sIdx2), sHi2 = Math.min(N_STEPS, sLo2 + 1);
      const f2 = sIdx2 - sLo2;
      const xVal = (1 - f2) * hero[sLo2] + f2 * hero[sHi2];
      ctx.fillStyle = 'rgba(60,60,60,0.75)';
      ctx.beginPath();
      ctx.arc(cx, yX(xVal), 3, 0, Math.PI * 2);
      ctx.fill();
      // image
      if (th.img.complete && th.img.naturalWidth > 0) {
        ctx.drawImage(th.img, ix, iy, THUMB_PX, THUMB_PX);
      } else {
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillRect(ix, iy, THUMB_PX, THUMB_PX);
      }
      // label below image
      ctx.fillStyle = 'rgba(40,40,40,0.85)';
      ctx.fillText(th.label, cx, iy + THUMB_PX + 4);
    }

    // time axis tick labels under thumbs
    ctx.fillStyle = 'rgba(60,60,60,0.55)';
    ctx.font = '11px ui-serif, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('t = 0', padL, thumbCenterY + THUMB_PX / 2 + 22);
    ctx.textAlign = 'right';
    ctx.fillText('t = 1', W - padR, thumbCenterY + THUMB_PX / 2 + 22);

    requestAnimationFrame(draw);
  }

  function drawDensity(ctx, xs, rho, rhoMax, anchorX, padT, plotH, xRange, side, label) {
    // side = -1 → density bulges leftward; +1 → rightward
    const BULGE = 56;  // px max bulge
    ctx.strokeStyle = 'rgba(60,60,60,0.7)';
    ctx.fillStyle = 'rgba(60,60,60,0.06)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const sy = padT + (1 - (xs[i] + xRange) / (2 * xRange)) * plotH;
      const sx = anchorX + side * (rho[i] / rhoMax) * BULGE;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    // small fill back to anchor for a curtain effect
    ctx.lineTo(anchorX, padT + plotH);
    ctx.lineTo(anchorX, padT);
    ctx.closePath();
    ctx.fill();

    // label at the top
    ctx.fillStyle = 'rgba(40,40,40,0.85)';
    ctx.font = '15px ui-serif, Georgia, serif';
    ctx.textAlign = side < 0 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, anchorX + side * 8, padT + 12);
  }

  requestAnimationFrame(draw);
})();
