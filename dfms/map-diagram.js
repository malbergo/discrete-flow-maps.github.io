// Static map picture: T_sharp rho_0 = rho_1, with three sample-to-sample arrows.
// Self-mounts on <canvas id="anim-map-diagram">.

(function () {
  const canvas = document.getElementById('anim-map-diagram');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function gaussPdf(x, mu, sg) {
    const d = (x - mu) / sg;
    return Math.exp(-0.5 * d * d) / (sg * Math.sqrt(2 * Math.PI));
  }
  function rho0(x) { return gaussPdf(x, 0, 0.85); }
  function rho1(x) {
    return 0.45 * gaussPdf(x, -0.9, 0.30) +
           0.35 * gaussPdf(x,  0.0, 0.32) +
           0.20 * gaussPdf(x,  1.0, 0.34);
  }

  // three samples in each density (positions chosen by hand for a clean picture)
  const SAMPLES = [
    { x0: -0.95, x1: -0.95, glyph: '\u2605' },   // ★
    { x0: -0.10, x1:  0.05, glyph: '\u25CB' },   // ○
    { x0:  0.55, x1:  0.95, glyph: '\u25A1' },   // □
  ];

  const DPR = window.devicePixelRatio || 1;
  function resize() {
    const cssW = canvas.parentElement.clientWidth;
    const cssH = Math.min(240, Math.max(180, cssW * 0.34));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }

  function draw() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const padX = 20, padTop = 10, padBot = 38;
    const gap = 28;
    const panelW = (W - 2 * padX - gap) / 2;
    const panelH = H - padTop - padBot;

    // panel rects (with subtle backgrounds)
    const xLeft = padX, xRight = padX + panelW + gap;
    const yPanel = padTop;
    ctx.fillStyle = 'rgba(170,170,170,0.07)';
    ctx.fillRect(xLeft, yPanel, panelW, panelH);
    ctx.fillRect(xRight, yPanel, panelW, panelH);

    // x-range for both densities
    const XMIN = -2.6, XMAX = 2.6;
    function xToPx(x, panelLeft) {
      return panelLeft + (x - XMIN) / (XMAX - XMIN) * panelW;
    }
    // shared y-scale: find max density
    const samples = 240;
    let maxD = 0;
    for (let i = 0; i < samples; i++) {
      const x = XMIN + (XMAX - XMIN) * i / (samples - 1);
      maxD = Math.max(maxD, rho0(x), rho1(x));
    }
    const baseY = yPanel + panelH * 0.78;
    const ampY = panelH * 0.62;
    function dToY(d) { return baseY - (d / maxD) * ampY; }

    // density curves
    function drawDensity(panelLeft, fn, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const x = XMIN + (XMAX - XMIN) * i / (samples - 1);
        const sx = xToPx(x, panelLeft);
        const sy = dToY(fn(x));
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    drawDensity(xLeft,  rho0, '#3858d6');
    drawDensity(xRight, rho1, '#3a8a5a');

    // density labels above the peaks
    ctx.font = '14px ui-serif, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#3858d6';
    ctx.fillText('\u03C1\u2080(x\u2080)', xLeft + panelW * 0.30, yPanel + 14);
    ctx.fillStyle = '#3a8a5a';
    ctx.fillText('\u03C1\u2081(x\u2081)', xRight + panelW * 0.30, yPanel + 14);

    // sample markers + mapping arrows
    ctx.font = '14px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const s of SAMPLES) {
      const sx0 = xToPx(s.x0, xLeft);
      const sx1 = xToPx(s.x1, xRight);
      const sy = baseY + 4;

      // dotted arc between paired samples
      ctx.strokeStyle = 'rgba(80,80,80,0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      const midX = (sx0 + sx1) / 2;
      const midY = sy + 56;
      ctx.moveTo(sx0, sy);
      ctx.quadraticCurveTo(midX, midY, sx1, sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // arrowhead at the right endpoint
      const ex = sx1, ey = sy;
      const tx = sx1 - 12, ty = sy - 4;
      const ang = Math.atan2(ey - ty, ex - tx);
      const HEAD = 7;
      ctx.fillStyle = 'rgba(80,80,80,0.7)';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - HEAD * Math.cos(ang - 0.5), ey - HEAD * Math.sin(ang - 0.5));
      ctx.lineTo(ex - HEAD * Math.cos(ang + 0.5), ey - HEAD * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fill();

      // glyphs (stroke + filled background to render cleanly)
      ctx.fillStyle = 'rgba(40,40,40,0.95)';
      ctx.fillText(s.glyph, sx0, sy);
      ctx.fillText(s.glyph, sx1, sy);
    }

    // T(star) label centered horizontally and at the bottom of the deepest arc
    const sStar = SAMPLES[0];
    const sx0 = xToPx(sStar.x0, xLeft);
    const sx1 = xToPx(sStar.x1, xRight);
    const sy0 = baseY + 4;
    // bottom of the quadratic arc at t=0.5 is (sy + midY)/2 with midY = sy + 56 → sy + 28
    ctx.fillStyle = 'rgba(60,60,60,0.85)';
    ctx.font = '13px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('T(\u2605)', (sx0 + sx1) / 2, sy0 + 32);
  }

  resize();
  window.addEventListener('resize', resize);
})();
