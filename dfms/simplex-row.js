// Row of K mini-simplices, each with its own per-position dynamics: a noise
// particle drifts toward one of three vertices (one-hot tokens). Above the
// row, a sentence assembles as the per-position particles land — the
// per-position picture for joint sequence diffusion.
// Self-mounts on <canvas id="anim-simplex-row">.

(function () {
  const canvas = document.getElementById('anim-simplex-row');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const C = {
    ink:    '#2e4552',
    accent: '#2f533f',
    cloud:  '#90a0aa',
    gold:   '#d4a843',
    fill:   '#f2eee0',
    g1:     '#2f533f',
    g2:     '#3d604c',
    g3:     '#4c6b5a',
  };

  const SENTENCE_BANKS = [
    ['the',  'quick',  'fox',  'will',  'softly', 'jump',  'over',   'fences'],
    ['a',    'lazy',   'bird', 'might', 'gently', 'soar',  'across', 'rivers'],
    ['one',  'bright', 'wolf', 'must',  'slowly', 'roam',  'under',  'stones'],
  ];

  // Flat vocabulary pool the per-position diffusion samples from each tick.
  const VOCAB = Array.from(new Set([].concat(...SENTENCE_BANKS)));

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = mulberry32(7);
  const L = 8;
  let targetSentence = SENTENCE_BANKS[0];
  let targets = [];           // vertex (0..2) each particle aims at
  let noiseY = [];
  let displayed = new Array(L).fill('');  // current per-position word being shown

  function pickSentence() {
    targetSentence = SENTENCE_BANKS[Math.floor(rng() * SENTENCE_BANKS.length)];
    targets = Array.from({ length: L }, () => Math.floor(rng() * 3));
    noiseY = Array.from({ length: L }, () => (rng() - 0.5) * 0.3);
    displayed = Array.from({ length: L }, () => VOCAB[Math.floor(rng() * VOCAB.length)]);
  }
  pickSentence();

  // Resample displayed words at a fixed tick rate (independent of frame rate).
  let lastTick = 0;
  const TICK_MS = 95;
  function tickDiffusion(time, t) {
    if (time - lastTick < TICK_MS) return;
    lastTick = time;
    // Lock in once t passes ~0.92.
    if (t >= 0.92) {
      for (let i = 0; i < L; i++) displayed[i] = targetSentence[i];
      return;
    }
    // Probability of showing target rises as t^3 — almost pure noise early,
    // snaps in late.
    const pTarget = Math.pow(t, 3);
    for (let i = 0; i < L; i++) {
      displayed[i] = rng() < pTarget
        ? targetSentence[i]
        : VOCAB[Math.floor(rng() * VOCAB.length)];
    }
  }

  // Layout
  let W = 0, H = 0;
  const DPR = window.devicePixelRatio || 1;
  function resize() {
    const cssW = canvas.parentElement.clientWidth;
    // Derive height from content layout so there's no slack above or below.
    const spacing = cssW / (L + 1);
    const ms = spacing * 0.36;
    const fs = Math.max(13, ms * 0.42);
    const topY_ = 8 + fs * 0.5;
    const rowY_ = topY_ + fs * 0.5 + 18 + ms * 1.05;
    const tBarY_ = rowY_ + ms * (0.6 + 1.55 + 0.15) + 26;
    const cssH = Math.ceil(tBarY_ + 10);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    W = cssW; H = cssH;
  }
  resize();
  window.addEventListener('resize', resize);

  // Easing
  function easeInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function drawFrame(t) {
    // t in [0,1]: 0 = pure noise, 1 = sharpened sentence
    ctx.clearRect(0, 0, W, H);

    const spacing = W / (L + 1);
    const miniScale = spacing * 0.36;
    const wordSize = Math.max(8, Math.min(11, miniScale * 0.24));
    const fontSize = Math.max(13, miniScale * 0.42);
    // Tight vertical packing: sentence band, then triangles immediately below.
    const topY = 8 + fontSize * 0.5;
    const rowY = topY + fontSize * 0.5 + 18 + miniScale * 1.05;
    const tBarY = rowY + miniScale * (0.6 + 1.55) + 0.15 * miniScale + 26;

    // Sentence band at top: each position is a random token sampled from the
    // vocab pool, annealing to the target as t -> 1.
    const isLocked = t >= 0.92;
    ctx.save();
    ctx.font = `italic ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Layout: fixed slot per position so words don't wiggle horizontally.
    const sentenceSpan = W * 0.86;
    const slotW = sentenceSpan / L;
    const slotStart = W / 2 - sentenceSpan / 2;
    for (let i = 0; i < L; i++) {
      const cx = slotStart + slotW * (i + 0.5);
      ctx.globalAlpha = isLocked ? 1.0 : 0.45 + 0.5 * t;
      ctx.fillStyle = isLocked ? C.ink : C.cloud;
      ctx.font = `${isLocked ? 'bold ' : 'italic '}${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillText(displayed[i], cx, topY);
    }
    ctx.restore();

    // Row of mini simplices
    for (let i = 0; i < L; i++) {
      const cx = spacing * (i + 1);
      const cy = rowY;

      const vTop   = [cx,                  cy - miniScale * 1.05];
      const vLeft  = [cx - miniScale,      cy + miniScale * 0.6];
      const vRight = [cx + miniScale,      cy + miniScale * 0.6];
      const verts = [vLeft, vTop, vRight];
      const colors = [C.g1, C.g2, C.g3];

      // triangle
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(...vLeft); ctx.lineTo(...vTop); ctx.lineTo(...vRight); ctx.closePath();
      ctx.fillStyle = C.fill;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // vertex dots
      for (let v = 0; v < 3; v++) {
        ctx.fillStyle = colors[v];
        ctx.beginPath();
        ctx.arc(verts[v][0], verts[v][1], 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // noise origin below
      const noiseYpx = cy + miniScale * 1.55 + noiseY[i] * miniScale;
      const noisePos = [cx, noiseYpx];

      // parallel dynamics: every position advances on the same t
      const localT = t;
      const ft = easeInOut(localT);
      const target = verts[targets[i]];
      const cur = [
        noisePos[0] + (target[0] - noisePos[0]) * ft,
        noisePos[1] + (target[1] - noisePos[1]) * ft,
      ];

      // trail
      ctx.save();
      ctx.globalAlpha = 0.22 * localT;
      ctx.beginPath();
      ctx.moveTo(...noisePos);
      const midx = (noisePos[0] + target[0]) / 2 + (i % 2 ? 8 : -8);
      const midy = (noisePos[1] + target[1]) / 2;
      ctx.quadraticCurveTo(midx, midy, cur[0], cur[1]);
      ctx.strokeStyle = colors[targets[i]];
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // particle
      ctx.save();
      ctx.fillStyle = colors[targets[i]];
      ctx.globalAlpha = 0.3 + 0.7 * localT;
      ctx.beginPath();
      ctx.arc(cur[0], cur[1], 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // landing glow
      if (ft > 0.97) {
        const glow = 0.25 + 0.15 * Math.sin(performance.now() / 480);
        ctx.save();
        ctx.fillStyle = colors[targets[i]];
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(target[0], target[1], miniScale * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // position-index label below noise
      if (i === 0 || i === L - 1) {
        ctx.save();
        ctx.fillStyle = 'rgba(46,69,82,0.35)';
        ctx.font = '10px ui-serif, Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`pos ${i + 1}`, cx, noiseYpx + 14);
        ctx.restore();
      }
    }

    // t-axis hint at bottom
    ctx.save();
    ctx.fillStyle = 'rgba(46,69,82,0.45)';
    ctx.font = '11px ui-serif, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(`t = ${t.toFixed(2)}`, 16, tBarY);
    ctx.restore();
  }

  let lastReplay = 0;
  function loop(time) {
    // Cycle: 0 -> 1 over ~5s, hold ~1s, reset
    const period = 6800;
    const u = ((time - lastReplay) % period) / period;
    if (u < 0.02 && time - lastReplay > period) {
      pickSentence();
      lastReplay = time;
    }
    const phase = Math.min(u * 1.2, 1.0);
    tickDiffusion(time, phase);
    drawFrame(phase);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
