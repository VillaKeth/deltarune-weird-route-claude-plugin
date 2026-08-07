// assets/ is gitignored — it is copyrighted Toby Fox material that this
// repository deliberately does not carry. Every test that spawns the real
// Electron window therefore cannot run on a fresh clone or in CI.
//
// These tests SKIP rather than fail, and skip rather than pass. That
// distinction is the whole point: several of the interaction cases expect
// "refuse", and a renderer with no border art also refuses — so on a clone
// they would go green for exactly the wrong reason. A skip is reported as a
// skip, is counted separately, and claims nothing about the code.
//
// Pass SKIP as the `skip` option of every test in such a file:
//
//   test("...", { skip: SKIP }, async () => { ... });
//
// Node treats `false` as "run it" and a string as "skip, and here is why".

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The three the popup renderer loads before it will draw anything: the frame,
// the gate portrait, and the portrait the route-complete box uses.
const REQUIRED = ["border.png", "noelle/trance.png", "noelle/speechless.png"];

const missing = REQUIRED.filter((a) => !existsSync(join(ROOT, "assets", a)));

export const SKIP = missing.length === 0
  ? false
  : `needs assets/${missing.join(", assets/")} — see the README's Install section`;
