import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const AUTO_CONTINUE_LIMIT = 25;

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "state");
const fresh = () => ({ routeActive: false, autoContinues: 0 });
const pathFor = (sessionId, dir) => join(dir, `${sessionId}.json`);

export async function loadState(sessionId, dir = DEFAULT_DIR) {
  try {
    const parsed = JSON.parse(await readFile(pathFor(sessionId, dir), "utf8"));
    return { routeActive: !!parsed.routeActive, autoContinues: parsed.autoContinues ?? 0 };
  } catch {
    return fresh();
  }
}

export async function saveState(sessionId, state, dir = DEFAULT_DIR) {
  await mkdir(dir, { recursive: true });
  await writeFile(pathFor(sessionId, dir), JSON.stringify(state), "utf8");
}

export const bump = (state) => ({ ...state, autoContinues: state.autoContinues + 1 });
export const reset = (state) => ({ ...state, autoContinues: 0 });
export const atLimit = (state) => state.autoContinues >= AUTO_CONTINUE_LIMIT;
