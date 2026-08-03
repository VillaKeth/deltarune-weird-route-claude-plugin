import { readLastAssistantText, extractNext } from "../src/transcript.mjs";
import { loadState, saveState } from "../src/state.mjs";
import { askUser } from "../src/renderer-client.mjs";
import { decide } from "../src/decide.mjs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, "..", "renderer", "popup", "main.mjs");

const readStdin = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
};

const payload = await readStdin();
if (!payload) process.exit(0);              // unparseable payload: do nothing

if (payload.hook_event_name === "Stop") {
  payload.next = extractNext(await readLastAssistantText(payload.transcript_path));
}

const sessionId = payload.session_id ?? "default";
const state = await loadState(sessionId);

const ask = (job) => askUser(job, { command: "npx", args: ["electron", RENDERER] });
const { output, nextState } = await decide(payload, state, ask);

await saveState(sessionId, nextState);
if (Object.keys(output).length) process.stdout.write(JSON.stringify(output));
process.exit(0);
