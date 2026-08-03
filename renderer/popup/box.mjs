// renderer/popup/box.mjs
//
// Classic script, NOT a module — Chromium refuses ES-module imports over
// file://, so a `type="module"` tag on box.html fails with an opaque CORS
// error. Every constant this file needs arrives over IPC from main.mjs,
// which is the only file that imports src/geometry.mjs.
const $ = (id) => document.getElementById(id);

// The 16x16 Deltarune soul, as measured rects. Drawn rather than shipped as a
// PNG so it needs no asset and scales exactly with the box.
const SOUL_RECTS = [
  [4, 1, 2, 1], [10, 1, 2, 1], [3, 2, 4, 1], [9, 2, 4, 1],
  [2, 3, 12, 5], [3, 8, 10, 2], [4, 10, 8, 1], [5, 11, 6, 1],
  [6, 12, 4, 1], [7, 13, 2, 1],
];

const soulSvg = (size) =>
  `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" width="${size}" height="${size}">` +
  `<g fill="#ff0000">` +
  SOUL_RECTS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("") +
  `</g></svg>`;

window.weird.onJob(({ job, scale, assets, box, rows }) => {
  const url = (p) => "file:///" + `${assets}/${p}`.replace(/\\/g, "/");

  // Font is injected with an absolute file:// URL. A relative @font-face url in
  // the stylesheet resolves against the page but is unreliable across Chromium's
  // file:// access rules; this form is not.
  const font = new FontFace("DTM", `url("${url("font/DeterminationMonoWeb.woff")}")`);
  const paint = () => {
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
    border.src = url("border.png");
    border.width = box.width;
    border.height = box.height;

    if (job.face) {
      const face = $("face");
      face.src = url(`noelle/${job.face}.png`);
      // 56x61 sprite centred in the 67x70 slot -> +5,+4. Derived, not hardcoded.
      face.style.left = `${box.slot.x + Math.floor((box.slot.w - 56) / 2)}px`;
      face.style.top = `${box.slot.y + Math.floor((box.slot.h - 61) / 2)}px`;
      face.width = 56; face.height = 61;
      face.hidden = false;
    }

    const textX = job.face ? box.textX.withPortrait : box.textX.noPortrait;
    $("text").innerHTML = job.lines.map((line, i) => {
      // An asterisk row hangs one pixel left; a continuation row does not.
      const x = line.startsWith("*") ? textX + box.asteriskOffset : textX;
      return `<span class="t" style="left:${x}px;top:${rows[i]}px">${
        line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
    }).join("");

    window.weird.ready();
  };

  font.load().then((f) => { document.fonts.add(f); paint(); }, paint);
});

window.weird.requestJob();
