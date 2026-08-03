import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const AUTO_CONTINUE_LIMIT = 25;

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "state");
const fresh = () => ({ routeActive: false, autoContinues: 0 });
const pathFor = (sessionId, dir) => join(dir, `${sessionId}.json`);

// The counter is the only ceiling on free-running, so a damaged one must not
// silently disable it. Anything that is not a non-negative integer is treated
// as unusable and reset to 0 on load; atLimit below fails closed if a damaged
// value reaches it in memory anyway.
const sanitiseCount = (value) =>
  Number.isInteger(value) && value >= 0 ? value : 0;

export async function loadState(sessionId, dir = DEFAULT_DIR) {
  try {
    const parsed = JSON.parse(await readFile(pathFor(sessionId, dir), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fresh();
    return {
      routeActive: !!parsed.routeActive,
      autoContinues: sanitiseCount(parsed.autoContinues),
    };
  } catch {
    return fresh();
  }
}

export async function saveState(sessionId, state, dir = DEFAULT_DIR) {
  await mkdir(dir, { recursive: true });
  await writeFile(pathFor(sessionId, dir), JSON.stringify(state), "utf8");
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
