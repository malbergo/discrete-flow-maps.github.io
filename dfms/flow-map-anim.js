// Flow map: semigroup composition X_{s,t} = X_{u,t} ∘ X_{s,u} and the
// secant-slope → velocity limit. Curve is a hand-matched cubic Bézier
// reproducing antpt.pdf p.2 (S-shape), not an SI characteristic.
//
// Self-mounts on <canvas id="anim-flow-map">.

(function () {
  const canvas = document.getElementById('anim-flow-map');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage-flow-map');
  stage.style.position = 'relative';

  // KaTeX-rendered overlay labels (created once, positioned per frame).
  // Styles are inlined so this works even before style.css revalidates.
  function mkLabel(tex, opts) {
    opts = opts || {};
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
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
    lim:  mkLabel('\\displaystyle\\lim_{t\\to s}\\partial_t X_{s,t}(x_s) = b_s(x_s)',
                  { size: 17, color: '#3858d6' }),
    xs:   mkLabel('x_s'),
    xu:   mkLabel('x_u'),
    xt:   mkLabel('x_t'),
    Xss:  mkLabel('X_{s,s}(x_s)'),
    Xsu:  mkLabel('X_{s,u}(x_s)'),
    Xst:  mkLabel('X_{s,t}(x_s) = X_{u,t}\\!\\circ\\! X_{s,u}(x_s)'),
  };
  // Render KaTeX directly so we don't depend on auto-render firing after us.
  (function renderLabels() {
    if (window.katex && katex.render) {
      for (const k in L) katex.render(L[k].dataset.tex, L[k], { throwOnError: false });
    } else {
      setTimeout(renderLabels, 30);
    }
  })();
  function place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; }

  // Bézier control points in normalized [0,1]×[0,1] (y up).
  // Tuned to match the reference: high-left crest → deep valley → high-right crest.
  const P0 = { x: 0.02, y: 0.58 };
  const P1 = { x: 0.32, y: 1.18 };   // overshoot pulls the left crest up
  const P2 = { x: 0.62, y: -0.28 };  // undershoot pulls the valley down
  const P3 = { x: 0.98, y: 0.78 };

  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
  }
  function bezD(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return 3*u*u*(p1-p0) + 6*u*t*(p2-p1) + 3*t*t*(p3-p2);
  }
  function curve(t) {
    return {
      x: bez(P0.x, P1.x, P2.x, P3.x, t),
      y: bez(P0.y, P1.y, P2.y, P3.y, t),
    };
  }
  function curveD(t) {
    return {
      x: bezD(P0.x, P1.x, P2.x, P3.x, t),
      y: bezD(P0.y, P1.y, P2.y, P3.y, t),
    };
  }

  // Parameter values placing x_s on the left crest, x_u in the valley, x_t on the right crest.
  const S = 0.20, T = 0.93, U_REST = 0.62;

  // ---------- thumbnails ----------
  const THUMBS = { noise: new Image(), mid: new Image(), clean: new Image() };
  THUMBS.noise.src = 'dfms/img/dt-flower-noise.png';
  THUMBS.mid.src   = 'dfms/img/dt-flower-mid.png';
  THUMBS.clean.src = 'dfms/img/dt-flower-clean.png';
  const THUMB_PX = 52;

  // ---------- layout ----------
  const DPR = window.devicePixelRatio || 1;
  function resize() {
    const cssW = stage.clientWidth;
    const cssH = Math.min(340, Math.max(250, cssW * 0.42));
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

    const padL = 18, padR = 18, padT = 34, padB = 92;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const sx = (nx) => padL + nx * plotW;
    const sy = (ny) => padT + (1 - ny) * plotH;
    function P(t) { const c = curve(t); return [sx(c.x), sy(c.y)]; }

    // ---- hero curve ----
    ctx.strokeStyle = 'rgba(20,20,20,0.95)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    const N = 240;
    let p = P(0);
    ctx.moveTo(p[0], p[1]);
    for (let i = 1; i <= N; i++) { p = P(i / N); ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
    arrowheadAlong(ctx, ...P(0.02), ...P(0), 11, 'rgba(20,20,20,0.95)');
    arrowheadAlong(ctx, ...P(0.98), ...P(1), 11, 'rgba(20,20,20,0.95)');

    // ---- animation: u sweeps S↔T, dwelling at U_REST ----
    const period = 6400;
    const ph = (time % period) / period;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * ph);
    const U = S + (T - S) * e;

    const pS = P(S), pU = P(U), pT = P(T);

    // ---- secant fan from x_s (static, matching the three faded arrows) ----
    const fanTs = [0.62, 0.42, 0.30];
    for (let i = 0; i < fanTs.length; i++) {
      const a = 0.18 + 0.18 * i;
      drawArrow(ctx, pS[0], pS[1], ...P(fanTs[i]),
                `rgba(56,88,214,${a.toFixed(2)})`, 2.0, 9);
    }
    // tangent at x_s (solid blue)
    const dS = curveD(S);
    const dn = Math.hypot(dS.x * plotW, -dS.y * plotH);
    const TAN = 0.24 * plotW;
    const tx = pS[0] + (dS.x * plotW)  / dn * TAN;
    const ty = pS[1] + (-dS.y * plotH) / dn * TAN;
    drawArrow(ctx, pS[0], pS[1], tx, ty, '#3858d6', 2.8, 11);

    // limit label — anchored just above x_s
    place(L.lim, pS[0] + 96, pS[1] - 24);

    // ---- semigroup hops ----
    ctx.setLineDash([4, 5]);
    drawArrow(ctx, pS[0], pS[1], pT[0], pT[1], 'rgba(90,90,90,0.40)', 1.5, 8);
    ctx.setLineDash([]);
    drawArrow(ctx, pS[0], pS[1], pU[0], pU[1], 'rgba(50,50,50,0.85)', 2.0, 9);
    drawArrow(ctx, pU[0], pU[1], pT[0], pT[1], 'rgba(50,50,50,0.85)', 2.0, 9);

    // ---- dots + labels ----
    dot(ctx, ...pS, '#8a6ad6', 6);
    dot(ctx, ...pU, '#8a6ad6', 6);
    dot(ctx, ...pT, '#8a6ad6', 6);
    place(L.xs, pS[0] - 14, pS[1] + 14);
    place(L.xu, pU[0] + 24, pU[1] + 22);
    place(L.xt, pT[0] + 14, pT[1] - 12);

    // ---- thumbnails + droplines ----
    const thumbY = H - padB + 8;
    // Spread the middle thumbnail left so it doesn't crowd the right one
    const midX = (pS[0] + pT[0]) / 2;
    const slots = [
      { px: pS[0], img: THUMBS.noise, lab: L.Xss },
      { px: midX,  img: THUMBS.mid,   lab: L.Xsu },
      { px: pT[0], img: THUMBS.clean, lab: L.Xst },
    ];
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(60,60,60,0.3)';
    ctx.lineWidth = 1;
    for (const s of slots) {
      ctx.beginPath();
      ctx.moveTo(s.px, padT + 10);
      ctx.lineTo(s.px, thumbY - 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const s of slots) {
      const ix = s.px - THUMB_PX / 2;
      if (s.img.complete && s.img.naturalWidth > 0) {
        ctx.drawImage(s.img, ix, thumbY, THUMB_PX, THUMB_PX);
      } else {
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillRect(ix, thumbY, THUMB_PX, THUMB_PX);
      }
      place(s.lab, s.px, thumbY + THUMB_PX + 12);
    }
    // shift last label right to avoid overlap with middle label
    place(L.Xst, pT[0] + 30, thumbY + THUMB_PX + 12);
    const xstW = L.Xst.offsetWidth;
    if (pT[0] + 30 + xstW / 2 > W) place(L.Xst, W - xstW / 2 - 2, thumbY + THUMB_PX + 12);

    requestAnimationFrame(draw);
  }

  function drawArrow(ctx, x0, y0, x1, y1, color, lw, head) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  function arrowheadAlong(ctx, x0, y0, x1, y1, head, color) {
    ctx.fillStyle = color;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  function dot(ctx, x, y, fill, r) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  requestAnimationFrame(draw);
})();
