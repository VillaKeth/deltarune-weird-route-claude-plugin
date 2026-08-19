import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "../src/png.mjs";
import { SKIP } from "./fixtures/needs-assets.mjs";
import { BOX, innerRight, rowY, OPTION_X, faceOffset } from "../src/geometry.mjs";

const SCALE = BOX.scale;
const JOB = {
  kind: "gate", face: "trance",
  lines: ["* Kris... it wants to", "  rewrite 14 files."],
  options: ["Proceed", "Refuse"], default: 0, sfx: null,
};

let seq = 0;
const capture = (job, keys) => new Promise((resolve, reject) => {
  const out = join(tmpdir(), `weird-render-${process.pid}-${seq++}.png`);
  const electron = createRequire(import.meta.url)("electron");
  const child = spawn(electron, ["renderer/popup/main.mjs"], {
    env: {
      ...process.env,
      WEIRD_ROUTE_CAPTURE: out,
      ...(keys ? { WEIRD_ROUTE_DEV: "1", WEIRD_ROUTE_KEYS: keys } : {}),
    },
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

test("the rendered box matches the declared geometry", { skip: SKIP }, async () => {
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

test("the choice row draws both options and the soul, at their declared positions", { skip: SKIP }, async () => {
  // Every other pixel assertion captures at beat 1, which leaves the part of
  // the box the user actually operates — the labels and the soul — visually
  // unverified. One Z advances to the choice; a second would confirm it.
  //
  // Asserted directly against the declared geometry rather than by diffing the
  // two beats. The choice now spans the portrait slot, which is empty on this
  // screen and drawn on the other, so a diff reports her absence as if it were
  // the choice row and the comparison stops meaning anything.
  const { png } = await capture(JOB, "Z");

  const band = (y) => y >= BOX.choiceY * SCALE && y < (BOX.choiceY + BOX.lineHeight) * SCALE;
  const glyphCols = (from, to) => {
    const cols = new Set();
    for (let x = from * SCALE; x < to * SCALE; x++) {
      for (let y = BOX.choiceY * SCALE; y < (BOX.choiceY + BOX.lineHeight) * SCALE; y++) {
        const p = png.px(x, y);
        if (p.a >= 128 && near(p, 255, 255, 255)) { cols.add(Math.floor(x / SCALE)); break; }
      }
    }
    return [...cols].sort((m, n) => m - n);
  };

  // Each label draws where geometry says it does, and nowhere else.
  for (const [label, x] of Object.entries(OPTION_X)) {
    const cols = glyphCols(x, x + label.length * BOX.advance);
    assert.ok(cols.length >= label.length * 3,
      `${label} drew ${cols.length} glyph columns at x=${x}`);
  }

  // The soul is red and sits one soul-width plus the gap left of "Proceed",
  // on the choice row rather than the last text row.
  const soulX = OPTION_X.Proceed - BOX.soul - BOX.soulGap;
  let red = 0;
  for (let y = BOX.choiceY * SCALE; y < (BOX.choiceY + BOX.soul) * SCALE; y++) {
    for (let x = soulX * SCALE; x < (soulX + BOX.soul) * SCALE; x++) {
      const p = png.px(x, y);
      if (p.r > 200 && p.g < 60 && p.b < 60) red++;
    }
  }
  assert.ok(red > 300, `soul drew ${red} red px at x=${soulX}, y=${BOX.choiceY} — not where geometry says`);

  // Nothing is drawn outside the group, on either side.
  assert.equal(glyphCols(BOX.border, soulX).length, 0, "something drew left of the soul");
  const refuseEnd = OPTION_X.Refuse + "Refuse".length * BOX.advance;
  assert.equal(glyphCols(refuseEnd, innerRight).length, 0, "something drew past the last label");

  // And it is on the declared row rather than the last text row, where it used
  // to sit. Checked against rowY(2) specifically: scanning every row outside the
  // band instead counts the frame's own white border art, which is not text.
  let stale = 0;
  for (let y = rowY(2) * SCALE; y < (rowY(2) + BOX.lineHeight) * SCALE; y++) {
    if (band(y)) continue;                       // the two rows overlap slightly
    for (let x = OPTION_X.Proceed * SCALE; x < refuseEnd * SCALE; x++) {
      const p = png.px(x, y);
      if (p.a >= 128 && near(p, 255, 255, 255)) stale++;
    }
  }
  assert.equal(stale, 0, `${stale} glyph px still drew on the old bottom text row`);
});

test("the portrait slot is empty on the choice screen", { skip: SKIP }, async () => {
  // The choice screen is not "her line, minus the words" — she is not on it at
  // all. Counting sprite pixels in the slot is the only check that can tell a
  // hidden portrait from one still sitting there behind the options.
  // The sprite's own rectangle, not the whole slot: the slot is larger than the
  // face and clips a few white pixels of border art at its edges, which are
  // there whether or not a portrait is. Nothing but the sprite draws here.
  // Rows the choice occupies are excluded. The choice is centred across the
  // whole inside of the box now, not tucked into the text column, so its labels
  // genuinely cross the slot her face would fill — and a white glyph counts the
  // same as a white outline. Her sprite is 61 px tall against an 18 px row, so
  // more than forty rows are still hers alone, which is ample: she draws
  // hundreds of pixels there when she is present and none when she is not.
  const facePixels = (png) => {
    let drawn = 0;
    for (let y = faceOffset.y * SCALE; y < (faceOffset.y + BOX.face.h) * SCALE; y++) {
      if (y >= BOX.choiceY * SCALE && y < (BOX.choiceY + BOX.lineHeight) * SCALE) continue;
      for (let x = faceOffset.x * SCALE; x < (faceOffset.x + BOX.face.w) * SCALE; x++) {
        const p = png.px(x, y);
        if (p.a >= 128 && near(p, 255, 255, 255)) drawn++;
      }
    }
    return drawn;
  };

  const { png: speaking } = await capture(JOB);
  const { png: choosing } = await capture(JOB, "Z");

  assert.ok(facePixels(speaking) > 200, "she should be drawn while she speaks");
  assert.equal(facePixels(choosing), 0,
    `the portrait is still drawn on the choice screen (${facePixels(choosing)} px)`);
});

test("beat 2 is its own screen: her line is gone, not merely clipped", { skip: SKIP }, async () => {
  // The two passes that paint text and options share coordinates, so the only
  // honest way to assert they do not collide is to look at the pixels. Both
  // captures are taken AT the choice, differing only in what she had to say:
  // if her line reaches the choice screen at all, they cannot match. The old
  // baseline was captured at beat 1, which stopped being comparable the moment
  // the portrait started disappearing at beat 2.
  const { png } = await capture(JOB, "Z");
  const { png: mute } = await capture({ ...JOB, lines: [] }, "Z");

  for (const row of [0, 1]) {
    let differing = 0;
    for (let y = rowY(row) * SCALE; y < (rowY(row) + BOX.lineHeight) * SCALE; y++) {
      for (let x = 0; x < png.w; x++) {
        const a = png.px(x, y), b = mute.px(x, y);
        if (a.r !== b.r || a.g !== b.g || a.b !== b.b || a.a !== b.a) differing++;
      }
    }
    assert.equal(differing, 0, `row ${row} still shows ${differing} px of her line at beat 2`);
  }
});
