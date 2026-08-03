// A sprite, as terminal cells.
//
// Each cell is U+2580 UPPER HALF BLOCK: the foreground colour paints its top
// half and the background colour its bottom, so one cell carries two vertically
// stacked source pixels and the sprite keeps its aspect ratio in a grid whose
// cells are about twice as tall as they are wide.
//
// Pure: takes a decoded image and returns strings. Nothing here touches a
// terminal, so the whole thing is reachable by node --test.
import { PX_PER_ROW, RESET, fg, bg, BLACK } from "./cells.mjs";

const BLOCK = "▀";

// The faces are two-tone line art whose outlines are one pixel wide, so any
// downsample that picks a single representative pixel drops whole outlines and
// any that averages turns them grey. The darkest opaque pixel in the block wins
// instead: an outline that passes through a block survives at every size, which
// is the only property that matters for line art.
const sample = (img, x0, y0, d, background) => {
  let best = null;
  let bestLuma = Infinity;
  for (let y = y0; y < y0 + d; y++) {
    for (let x = x0; x < x0 + d; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const p = img.px(x, y);
      if (p.a < 128) continue;
      const luma = p.r * 0.299 + p.g * 0.587 + p.b * 0.114;
      if (luma < bestLuma) { bestLuma = luma; best = p; }
    }
  }
  return best ? [best.r, best.g, best.b] : background;
};

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function halfBlocks(img, { divisor = 1, background = BLACK } = {}) {
  const d = Number.isInteger(divisor) && divisor > 0 ? divisor : 1;
  const cols = Math.ceil(img.w / d);
  const rows = Math.ceil(img.h / (d * PX_PER_ROW));
  const out = [];

  for (let r = 0; r < rows; r++) {
    let line = "";
    let curFg = null;
    let curBg = null;
    for (let c = 0; c < cols; c++) {
      const x = c * d;
      const top = sample(img, x, (r * PX_PER_ROW) * d, d, background);
      const bottom = sample(img, x, (r * PX_PER_ROW + 1) * d, d, background);
      // Colour codes are only emitted where the colour actually changes. A face
      // is mostly flat, so this cuts the row to a fraction of its length, and a
      // shorter row is a faster redraw — this renderer repaints continuously.
      if (!curFg || !same(curFg, top)) { line += fg(top); curFg = top; }
      if (!curBg || !same(curBg, bottom)) { line += bg(bottom); curBg = bottom; }
      line += BLOCK;
    }
    out.push(line + RESET);
  }
  return out;
}

// How many cells wide a row is, ignoring the escape sequences inside it. The
// frame builder pads rows to a fixed width, and counting raw string length
// would count the colour codes.
export const cellWidth = (row) => stripAnsi(row).length;

export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
