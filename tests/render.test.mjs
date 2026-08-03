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

const capture = () => new Promise((resolve, reject) => {
  const out = join(tmpdir(), `weird-render-${process.pid}.png`);
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
  child.stdin.end(JSON.stringify(JOB));
});

const near = (p, r, g, b) => Math.abs(p.r - r) < 6 && Math.abs(p.g - g) < 6 && Math.abs(p.b - b) < 6;

test("the rendered box matches the declared geometry", async () => {
  const { png } = await capture();

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

  // Row 0 must contain glyphs, and they must be inside the opaque text block
  // (measured at x 74..222). Anything in the right portrait slot is overflow.
  const band = (from, to) => {
    let lit = 0;
    for (let y = rowY(0) * SCALE; y < (rowY(0) + BOX.lineHeight) * SCALE; y++)
      for (let x = from * SCALE; x < to * SCALE; x++)
        if (near(png.px(x, y), 255, 255, 255)) lit++;
    return lit;
  };
  assert.ok(band(74, 223) > 100, "row 0 has no glyphs — the font did not load");
  assert.equal(band(223, innerRight), 0, "text overflowed past the text block");
});
