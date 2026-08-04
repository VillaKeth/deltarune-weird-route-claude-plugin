# Deltarune Weird Route — Claude Code plugin

Gates Claude's autonomy behind Deltarune's Weird Route dialogue box. Noelle says what
Claude is about to do; the player moves the soul with the arrow keys and answers
**Proceed** or **Refuse**.

- `hooks/gate.mjs` — the plugin. `UserPromptSubmit`, `PreToolUse`, `Stop`, `Notification`
- `src/` — geometry, transcript reader, state, job builder, renderer client, nav rules
- `renderer/popup/` — the Electron window
- `assets/` — sprites, font, SFX (**gitignored**, copyrighted Toby Fox material)
- `docs/superpowers/specs/` — start with the 2026-08-03 design

## Invariants

**Fail closed, always.** A renderer crash, a window that will not open, malformed
output, a timeout, damaged state, an empty options list, an out-of-range cursor — all
resolve to **Refuse**. A gate that fails open silently hands Claude unrestricted tool
access, which is the one outcome worse than the plugin not working. Only the exact
string `"proceed"` proceeds, and only the exact label `"Proceed"` confirms.

**A crashed hook fails OPEN.** This is why every module on the hook path is written
never to throw. Claude Code catching a crashed `PreToolUse` hook is not a safety net —
it is the hole. `decide()`, `buildJob()`, `keyAction()` and the transcript reader are
all outermost boundaries that return a safe value instead of throwing.

**The decision reaches stdout before anything touches the disk.** `saveState` can fail
on a full disk, a permission error, or Windows lock contention. A stale counter is the
cheaper loss; a computed-but-undelivered decision is a fail-open.

**Geometry is declared once,** in `src/geometry.mjs`. No other file may restate a pixel
value. Character advance is **8 px** — measured, not guessed; a hardcoded guess produced
the first broken render.

**Z-order is load-bearing:** fill → sprite → border → text → soul. The border art has an
opaque black block over the text area (x 74–222, measured) and transparent portrait
slots. Drawing it last hides every glyph.

**The faces are two-tone line art,** 56×61, exactly `rgb(255,255,255)` fill and
`rgb(0,0,0)` outline. Never apply a CSS tint or filter — it erases the outlines. The
corner dots are already baked into `border.png`; do not draw them again.

**A piped hook can still reach the real console.** `\\.\CONOUT$` and `\\.\CONIN$`
on Windows, `/dev/tty` elsewhere — verified by reading the console buffer back and
finding this session's own output in it. This is why phase 2 needs no PTY, no
wrapper process and no native dependency. Two non-guessable details: `CONIN$` must
be opened **`"r+"`** because `setRawMode` calls `SetConsoleMode`, which needs write
access and fails `EPERM` on a read-only handle; and raw mode must be set **before**
attaching a `data` listener, because a listener on a cooked console blocks the
event loop on a line read that never returns — which also stops the failsafe timer.

**Arrow keys arrive as CSI sequences, measured not assumed.** Injecting real
`KEY_EVENT_RECORD`s with `WriteConsoleInput` and logging what a raw `CONIN$` stream
delivers: `VK_RIGHT` → `1b 5b 43`, `LEFT` → `1b 5b 44`, `UP` → `1b 5b 41`, Escape →
a bare `1b`, Enter → `0d`. Raw mode reports console mode `0x208`, so
`ENABLE_VIRTUAL_TERMINAL_INPUT` is on and `ENABLE_LINE_INPUT` is off. The scan code
and `ENHANCED_KEY` do not matter; the virtual key code alone is enough. The whole
interaction has been driven end to end this way — arrows, clamping at both ends of
the option list, Escape, and console mode restored to its exact prior value.

**Claude Code repaints over anything drawn to its console.** The box does not fight
for the screen; it redraws on a 100 ms heartbeat, faster than it can be clobbered.

**The window is clamped to the work area on all four sides,** in
`src/window-place.mjs`. Two separate bugs put the box on the wrong monitor: first
`workAreaSize`, which is a *size* with no origin, so every coordinate was implicitly
relative to the primary display; then a cascade offset clamped only to the left and
top, which let a corner placement slide off to the right — and off the right edge
means onto the neighbouring monitor. Corner anchors cascade **inward**, because a
box anchored `MARGIN` from an edge has only `MARGIN` of room before it. A display
left of the primary one has a **negative** origin, so nothing may clamp against zero.

**`src/cells.mjs` owns cell values the way `geometry.mjs` owns pixel values.** The
two spaces do not share a scale — text is 8 px per column but the sprite is 1 px per
column — so only the *relationships* cross over, never the numbers.

**A terminal renderer must restore the terminal.** Alternate screen off, cursor
back, raw mode off, on every exit path. `renderer-client` kills at 120 s with
SIGKILL, which cannot be caught, so the inline failsafe fires at 110 s to win that
race — a process killed mid-scene leaves the user in a raw alternate screen.

**Never `await app.whenReady()` at the top level of the ESM main process.** Electron
withholds `ready` until the entry module finishes evaluating, so it deadlocks: the
process sits forever with no window, no error, and no output. Use `.then()`.

**Electron's main process cannot read stdin as a stream.** `for await`, `'data'` and
`'readable'` all observe an immediate EOF with zero bytes while the pipe genuinely
holds the data. Read fd 0 with `readSync`.

**The page can never import.** Chromium refuses ES-module imports over `file://`, so
anything `box.html` loads is a classic script with no imports and no exports — and
therefore unreachable by `node --test`. All rules live in `src/nav.mjs` and run in main;
the page is a dumb painter.

**The window always has a hard teardown.** An independent timer force-closes and refuses
at 120 s regardless of state. Never ship a path where a bug can leave an un-closable
always-on-top window on someone's screen.

**Assets are never committed.** Copyrighted Toby Fox material. `.gitignore` keeps them
out deliberately — do not add them, and do not `git add -f` them.

**`claude plugin install` from a local directory copies the whole working tree, and
ignores `.gitignore`.** Measured against a throwaway `CLAUDE_CONFIG_DIR`: 625 files
and 15.4 MB landed in the plugin cache, including `assets/` (21 copyrighted files),
`.claude/_archive-wellnessscape/` (22 files belonging to another project), and
`.claude/settings.local.json` — which carries `"defaultMode": "bypassPermissions"`.
A plugin that exists to gate autonomy must not ship a permission bypass. Installing
from **git** is the only safe distribution path, because a clone carries committed
files only. Never point a marketplace at this working directory for anything but a
local experiment.

**Installation keeps downloading after it reports success.** The same measurement
went from 15.4 MB to 362.8 MB *after* `claude plugin install` printed
"Successfully installed": it runs `npm install`, which fetches the Electron binary.
A gate that fires during that window cannot resolve Electron and refuses. Safe, but
every tool call refuses until the download lands.

**Stage named paths.** Never `git add -A` or `git add .`. A task once swept an unrelated
untracked tree into its commit, including another project's files and a
`bypassPermissions` settings file.

**The plugin makes no model calls.** The `NEXT:` marker is a plain string read from the
transcript. No sub-agents, no extra inference, ever.

## Toolchain

Node 24 / npm 11, Electron 43, git. No pnpm, no rust on this box.

```powershell
npm install
npm test                              # node --test
node tools/show-box.mjs               # see the box
```

Type **"weird route"** in a prompt to start the route. `TEST_MODE=1` gates every tool
regardless of the route flag, so the box fires in seconds instead of on a real gate.

Test seams, all no-ops in production: `WEIRD_ROUTE_RENDERER_CMD` / `_ARGS` / `_ENTRY`
(stub the renderer), `WEIRD_ROUTE_CAPTURE` (screenshot and exit), `WEIRD_ROUTE_KEYS`
(replay real key events), `WEIRD_ROUTE_FAILSAFE_MS` (shorten the teardown timer).

## ⚠️ Sub-Agent & Workflow Token Guardrail

A prior session burned the token budget by silently building a multi-step automated
workflow that fired ~100 model calls. Do not repeat it.

1. **Hard cap: 3 sub-agents / Task-tool invocations at once**, for any reason. If a plan
   seems to need more, stop and ask first — do not queue extras behind the cap.
2. **No self-directed multi-agent workflows.** Do not design or start a pipeline that
   chains model calls in a loop without explicit approval of that specific plan, in that
   session.
3. **Before spawning any sub-agent, state:** how many will run and what each is for. Get
   confirmation if the count is more than 1.
4. **Never call a non-default model in an automated loop.**
5. If a task looks big enough to "need" a workflow, say so and ask how to scope it down.
6. This sits above "be helpful" — a runaway workflow is a cost incident, not a win.

**Verify subagent claims.** In this project a subagent spent 38 minutes concluding
Bitdefender was blocking Electron; it was actually running `electron.exe` from
PowerShell, which does not wait for GUI-subsystem binaries and shows none of their
output. Reproduce a diagnosis before acting on it — and suspect your own probe harness
first. Eight separate false alarms here came from broken harnesses, not broken code.

Three of those eight came from one afternoon of verifying the inline renderer, and
all three are PowerShell traps worth naming:

- `Add-Type -MemberDefinition` already emits `using System.Runtime.InteropServices`.
  Passing `-UsingNamespace System.Runtime.InteropServices` duplicates it, which is
  CS0105, which `Add-Type` treats as an **error**. It failed silently for two runs
  while every `[Con.Api]::` call threw into an uncaptured stderr.
- `0xC0000000` as a bare literal overflows `Int32` and comes out negative, so the
  `uint` parameter conversion throws and the assignment never happens. Cast it:
  `[uint32]3221225472`.
- A struct passed to a `CharSet=Unicode` API needs `CharSet=CharSet.Unicode` on its
  own `[StructLayout]`. The default is Ansi, and a `char` field then marshals as one
  byte, silently wrecking every offset after it.

And one that was not a harness bug but looked exactly like one: a key script that
waits longer than the typewriter crawl (40 chars × 35 ms = 1400 ms) finds nothing
left to skip, so the first `z` opens the choice and the second **answers** it. Four
"the renderer ignores arrow keys" failures were really the scene answering before
the arrow was ever sent.
