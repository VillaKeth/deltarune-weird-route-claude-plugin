import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "../tools/png.mjs";
import { BOX, innerRight, rowY } from "../src/geometry.mjs";

const SCALE = 3;
const JOB = {
  kind: "gate", face: "trance",
  lines: ["* Kris... it wants to", "  rewrite 14 files."],
  options: ["Proceed", "Refuse"], default: 0, sfx: null,
};

let seq = 0;
const capture = (job) => new Promise((resolve, reject) => {
  const out = join(tmpdir(), `weird-render-${process.pid}-${seq++}.png`);
  const electron = createRequire(import.meta.url)("electron");
  const child = spawn(electron, ["renderer/popup/main.mjs"], {
    env: { ...process.env, WEIRD_ROUTE_CAPTURE: out },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (c) => (err += c));
  child.on("close", (code) => {
    try { resolve({ png: decodePng(out), code }); }
    catch (e) { reject(new Error(`no capture (exit ${code}): ${err.slice(0, 400)}`)); }
    finally { rmSync(out, { force: true }); }
  });
  child.stdin.end(JSON.stringify(job));
});

const near = (p, r, g, b) => Math.abs(p.r - r) < 6 && Math.abs(p.g - g) < 6 && Math.abs(p.b - b) < 6;

test("the rendered box matches the declared geometry", async () => {
  const { png } = await capture(JOB);

  assert.equal(png.w, BOX.width * SCALE);
  assert.equal(png.h, BOX.height * SCALE);

  // The corner dots come from border.png. Correct colour at the correct scaled
  // position proves the border loaded, sits at 0,0 and scaled by exactly SCALE.
  for (const [x, y] of BOX.corners) {
    const p = png.px(x * SCALE + 1, y * SCALE + 1);
    assert.ok(near(p, 170, 255, 230), `corner (${x},${y}) was rgb(${p.r},${p.g},${p.b})`);
  }

  // The face is two-tone line art. Both colours must survive — a CSS tint would
  // erase the black and this assertion is what catches that.
  let black = 0, white = 0;
  for (let y = BOX.slot.y * SCALE; y < (BOX.slot.y + BOX.slot.h) * SCALE; y++) {
    for (let x = BOX.slot.x * SCALE; x < (BOX.slot.x + BOX.slot.w) * SCALE; x++) {
      const p = png.px(x, y);
      if (p.a < 128) continue;
      if (near(p, 255, 255, 255)) white++;
      else if (near(p, 0, 0, 0)) black++;
    }
  }
  assert.ok(white > 200, `face has ${white} white px — sprite did not load`);
  assert.ok(black > 200, `face has ${black} black px — outlines lost, sprite was tinted`);

  // Glyphs are isolated by diffing against a capture of the same box with no
  // text. Thresholding on "white" alone cannot do this: the border art is also
  // white, and the sprite's fill is white, so a naive scan reports the frame at
  // x 289-292 as overflowing text. The baseline self-calibrates against
  // whatever the assets happen to contain.
  const { png: baseline } = await capture({ ...JOB, lines: [] });
  assert.equal(baseline.w, png.w, "baseline capture must be comparable");

  const glyphColumns = (row) => {
    const cols = new Set();
    for (let y = rowY(row) * SCALE; y < (rowY(row) + BOX.lineHeight) * SCALE; y++) {
      for (let x = 0; x < png.w; x++) {
        const a = png.px(x, y), b = baseline.px(x, y);
        if (a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a) continue;
        if (near(a, 255, 255, 255)) cols.add(Math.floor(x / SCALE));
      }
    }
    return [...cols].sort((m, n) => m - n);
  };

  const row0 = glyphColumns(0);
  assert.ok(row0.length > 40, `row 0 has ${row0.length} glyph columns — the font did not load`);

  // "* Kris... it wants to" is 21 chars. The asterisk row hangs one pixel left,
  // so it starts at textX-1 and cannot reach past textX-1 + 21*advance.
  const startX = BOX.textX.withPortrait + BOX.asteriskOffset;
  assert.ok(row0[0] >= startX, `row 0 starts at x=${row0[0]}, before ${startX}`);
  assert.ok(row0[row0.length - 1] <= startX + JOB.lines[0].length * BOX.advance,
    `row 0 ends at x=${row0[row0.length - 1]}, past its ${JOB.lines[0].length}-char extent`);
  assert.ok(row0[row0.length - 1] < innerRight,
    `row 0 ends at x=${row0[row0.length - 1]}, past the inner right edge ${innerRight}`);

  // The continuation row carries a two-space indent and no asterisk, so it must
  // start strictly right of row 0.
  const row1 = glyphColumns(1);
  assert.ok(row1.length > 30, `row 1 has ${row1.length} glyph columns`);
  assert.ok(row1[0] > row0[0], `row 1 starts at ${row1[0]}, not indented past row 0's ${row0[0]}`);
  assert.ok(row1[row1.length - 1] < innerRight, `row 1 ran past the inner right edge`);

  // Row 2 was never given a line, so nothing may be drawn there.
  assert.equal(glyphColumns(2).length, 0, "row 2 drew text it was not given");
});
