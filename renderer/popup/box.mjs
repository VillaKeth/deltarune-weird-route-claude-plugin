// renderer/popup/box.mjs
//
// Classic script, NOT a module — Chromium refuses ES-module imports over
// file://, so a `type="module"` tag on box.html fails with an opaque CORS
// error. This file therefore holds no rules and no state of its own: it paints
// what main.mjs tells it to. Every constant arrives over IPC, and every
// decision is made by src/nav.mjs in the main process.
const $ = (id) => document.getElementById(id);

// The 16x16 Deltarune soul, as measured rects. Drawn rather than shipped as a
// PNG so it needs no asset and scales exactly with the box.
const SOUL_RECTS = [
  [4, 1, 2, 1], [10, 1, 2, 1], [3, 2, 4, 1], [9, 2, 4, 1],
  [2, 3, 12, 5], [3, 8, 10, 2], [4, 10, 8, 1], [5, 11, 6, 1],
  [6, 12, 4, 1], [7, 13, 2, 1],
];

// The rects are authored on a 16x16 grid, so the viewBox is that grid — not a
// restatement of BOX.soul. The rendered size is BOX.soul, passed in.
const SOUL_GRID = 16;

const soulSvg = (size) =>
  `<svg viewBox="0 0 ${SOUL_GRID} ${SOUL_GRID}" shape-rendering="crispEdges" width="${size}" height="${size}">` +
  `<g fill="#ff0000">` +
  SOUL_RECTS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("") +
  `</g></svg>`;

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

let ctx = null;

// A missing sound effect is cosmetic and must never block or fail the box.
const audio = new Map();
window.weird.onSfx((file) => {
  if (!ctx || !file) return;
  try {
    let a = audio.get(file);
    if (!a) { a = new Audio(`${ctx.base}/sfx/${file}`); audio.set(file, a); }
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch { /* cosmetic */ }
});

// Text is drawn one row at a time, sliced to however many characters the main
// process says have been revealed. The typewriter is main's clock, not ours.
const drawText = (revealed, beat) => {
  const { job, box, rows } = ctx;
  const textX = job.face ? box.textX.withPortrait : box.textX.noPortrait;
  // The two beats are two screens. Beat 2 is the choice and nothing else — her
  // line is gone, exactly as the game does it. Clipping only the choice row was
  // not enough: text and options are painted by two independent passes at the
  // same coordinates, so they still shared the box.
  if (beat === 2 && job.options.length > 0) {
    $("text").innerHTML = "";
    return;
  }
  let budget = revealed;
  const spans = [];
  job.lines.forEach((line, i) => {
    if (i >= rows.length) return;          // a job carrying more rows than exist
    const shown = line.slice(0, Math.max(0, budget));
    budget -= line.length;
    // An asterisk row hangs one pixel left; a continuation row does not.
    const x = line.startsWith("*") ? textX + box.asteriskOffset : textX;
    spans.push(`<span class="t" style="left:${x}px;top:${rows[i]}px">${escapeHtml(shown)}</span>`);
  });
  $("text").innerHTML = spans.join("");
};

const drawChoice = (beat, cursor) => {
  const { job, box, rows, optionX } = ctx;
  const host = $("options");
  const soul = $("soul");

  if (beat !== 2 || job.options.length === 0) {
    host.innerHTML = "";
    soul.hidden = true;
    return;
  }

  host.innerHTML = job.options
    .map((label) => {
      const x = optionX[label];
      if (typeof x !== "number") return "";
      return `<span class="t" style="left:${x}px;top:${rows[2]}px">${escapeHtml(label)}</span>`;
    })
    .join("");

  const label = job.options[cursor];
  const x = optionX[label];
  if (typeof x !== "number") { soul.hidden = true; return; }
  soul.innerHTML = soulSvg(box.soul);
  // One soul-width plus the declared gap, left of its label.
  soul.style.left = `${x - box.soul - box.soulGap}px`;
  soul.style.top = `${rows[2]}px`;
  soul.hidden = false;
};

window.weird.onRender(({ revealed, beat, cursor }) => {
  if (!ctx) return;
  drawText(revealed, beat);
  drawChoice(beat, cursor);
});

window.weird.onJob((data) => {
  const { job, scale, assets, box, rows, optionX, faceOffset, state } = data;
  const base = "file:///" + String(assets).replace(/\\/g, "/");
  ctx = { job, box, rows, optionX, faceOffset, base };

  const b = $("box");
  b.style.width = `${box.width}px`;
  b.style.height = `${box.height}px`;
  b.style.transform = `scale(${scale})`;
  b.style.fontSize = `${box.fontSize}px`;
  b.style.lineHeight = `${box.lineHeight}px`;

  Object.assign($("fill").style, {
    left: `${box.border}px`, top: `${box.border}px`,
    width: `${box.width - box.border * 2}px`,
    height: `${box.height - box.border * 2}px`,
  });

  const border = $("border");
  border.src = `${base}/border.png`;
  border.width = box.width;
  border.height = box.height;

  if (job.face) {
    const face = $("face");
    face.src = `${base}/noelle/${job.face}.png`;
    // Sprite size and its centring offset are both computed in geometry.mjs and
    // arrive over IPC. They were written here as the literals 56 and 61 under a
    // comment claiming they were derived, which is exactly the duplication the
    // spec forbids.
    face.style.left = `${ctx.faceOffset.x}px`;
    face.style.top = `${ctx.faceOffset.y}px`;
    face.width = box.face.w;
    face.height = box.face.h;
    face.hidden = false;
  }

  // Font is loaded with an absolute URL. A relative @font-face url in the
  // stylesheet is unreliable across Chromium's file:// access rules.
  const font = new FontFace("DTM", `url("${base}/font/DeterminationMonoWeb.woff")`);
  const paint = () => {
    drawText(state.revealed, state.beat);
    drawChoice(state.beat, state.cursor);
    window.weird.ready();
  };
  font.load().then((f) => { document.fonts.add(f); paint(); }, paint);
});

window.weird.requestJob();
