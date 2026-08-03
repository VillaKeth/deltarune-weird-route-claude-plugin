import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const AUTO_CONTINUE_LIMIT = 25;

// Overridable so tests can use a temp directory instead of writing session
// files into the real state/ dir, where a test id could in principle collide
// with a live session. Cannot force a Proceed: a bad directory yields fresh
// state, which means the route reads as off and no box is shown — the same as
// the default state, never an approval.
const DEFAULT_DIR = process.env.WEIRD_ROUTE_STATE_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "state");
const fresh = () => ({ routeActive: false, autoContinues: 0 });
const pathFor = (sessionId, dir) => join(dir, `${sessionId}.json`);

// The counter is the only ceiling on free-running, so a damaged one must not
// silently disable it. Anything that is not a non-negative integer is treated
// as unusable and reset to 0 on load; atLimit below fails closed if a damaged
// value reaches it in memory anyway.
const sanitiseCount = (value) =>
  Number.isInteger(value) && value >= 0 ? value : 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shape = (parsed) => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fresh();
  return {
    routeActive: !!parsed.routeActive,
    autoContinues: sanitiseCount(parsed.autoContinues),
  };
};

// Claude Code fires hooks concurrently — two tool calls in one assistant block
// is ordinary and encouraged. A read landing inside another invocation's write
// used to observe an empty or half-written file, and mapping that onto fresh()
// reports routeActive:false for a route that is on. Measured before the fix:
// 1936 of 14726 contended reads (13.1%) saw the route as OFF while the file on
// disk said ON. Each one skipped a gate AND then persisted the route as dead.
//
// saveState below is atomic, so a torn read is no longer possible; the retry
// here covers the Windows sharing violation that can still surface while a
// rename is in flight. Only a genuinely absent file yields fresh() without a
// fight — every other error is transient until proven otherwise, because
// guessing "route off" is the fail-open direction.
export async function loadState(sessionId, dir = DEFAULT_DIR) {
  const path = pathFor(sessionId, dir);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return shape(JSON.parse(await readFile(path, "utf8")));
    } catch (e) {
      if (e?.code === "ENOENT") return fresh();      // no session yet: genuinely fresh
      if (attempt === 4) return fresh();             // give up, but only after trying
      await sleep(5 * (attempt + 1));
    }
  }
  return fresh();
}

// Write to a unique temp file and rename over the target. rename is atomic on
// both NTFS and POSIX, so a concurrent reader sees either the whole old file or
// the whole new one — never a truncated one. A plain writeFile opens O_TRUNC
// and then writes, which leaves the file empty for as long as the write takes.
export async function saveState(sessionId, state, dir = DEFAULT_DIR) {
  await mkdir(dir, { recursive: true });
  const target = pathFor(sessionId, dir);
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, JSON.stringify(state), "utf8");
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rename(tmp, target);
      } catch (e) {
        // Windows can refuse the replace while another process has the target
        // open for reading. That is transient; a real error still surfaces.
        if (attempt === 4 || (e?.code !== "EPERM" && e?.code !== "EBUSY" && e?.code !== "EACCES")) throw e;
        await sleep(5 * (attempt + 1));
      }
    }
  } catch (e) {
    await unlink(tmp).catch(() => {});    // never leave temp files behind
    throw e;
  }
}

export const bump = (state) => ({
  ...state,
  autoContinues: sanitiseCount(state?.autoContinues) + 1,
});

export const reset = (state) => ({ ...state, autoContinues: 0 });

// Fails closed: a counter that is not a usable number is treated as AT the
// limit, so a damaged state file forces the box back rather than removing the
// only ceiling on free-running.
export const atLimit = (state) =>
  !Number.isInteger(state?.autoContinues) || state.autoContinues >= AUTO_CONTINUE_LIMIT;
