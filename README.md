# Deltarune Weird Route

A Claude Code plugin that gates Claude's autonomy behind Deltarune's Weird Route
dialogue box. Noelle states what Claude is about to do; you move the soul with the
arrow keys and answer **Proceed** or **Refuse**.

Proceed lets Claude keep running on its own. Refuse stops it and hands the terminal
back to you.

## Install

```powershell
npm install
```

Then drop the sprites, font and sound effects into `assets/` (see the design doc for
sources). They are copyrighted material and are **not** in this repository.

```
assets/border.png                 297x84 RGBA
assets/font/DeterminationMonoWeb.woff
assets/noelle/{trance,mortified,mortified_stare,mortified_breakingdown,
               scared,stunned,shocked,speechless}.png     56x61 RGBA
assets/sfx/{ui_spooky_action,ominous_cancel,ui_move,ui_select,voice_noelle}.wav
```

The hooks are already registered in `.claude/settings.json`.

## Use

Type **`weird route`** in any prompt. A box appears asking whether to begin.

Once the route is running:

| When | What happens |
|---|---|
| Claude wants to `Write`, `Edit`, `Bash`, `WebFetch` or `Task` | The box asks. Proceed allows the call; Refuse denies it and ends the route. |
| Claude ends a turn with a `NEXT:` line | It continues silently. No box, no keypress. |
| 25 silent continues in a row | The box comes back and requires an explicit Proceed. |
| Claude ends a turn with nothing left to do | A closing box with no choice. `Z` dismisses it. |

`Read`, `Grep` and `Glob` never gate — gating them would produce a box every few
seconds.

**Refuse always ends the route.** It is not "reject this one step" — it denies what
was asked, stops Claude, plays the abort jingle, and gives you back a normal prompt.

## Controls

`Z` advances her line, then confirms. `←` `→` move the soul. `X` goes back to her
line. `Esc` always closes the window and refuses. The box can also be dragged.

## Where the box appears

Dead centre is the game-accurate placement, and it lands on top of whatever you are
working on. Set `WEIRD_ROUTE_POS` to move it:

```powershell
$env:WEIRD_ROUTE_POS = "bottom-right"
```

`center` (default), `top-left`, `top-right`, `bottom-left`, `bottom-right`. Concurrent
boxes cascade from there so none can hide underneath another.

## Develop

```powershell
npm test                    # 110 tests, node --test
node tools/show-box.mjs     # see the box without a gate
```

`TEST_MODE=1` gates every tool regardless of the route flag, so the box fires in
seconds instead of on a real gate:

```powershell
$env:TEST_MODE = "1"; claude
```

Test seams:

| Variable | Effect | Can force a Proceed |
|---|---|---|
| `WEIRD_ROUTE_DEV=1` | Unlocks the two seams below. Prints a warning to stderr. | — |
| `WEIRD_ROUTE_RENDERER_CMD` / `_ARGS` | Run a stub instead of Electron | **yes** — needs `_DEV=1` |
| `WEIRD_ROUTE_KEYS` | Replay real key events through the window | **yes** — needs `_DEV=1` |
| `WEIRD_ROUTE_RENDERER_ENTRY` | Point the gate at a different renderer entry | no — a bad path refuses |
| `WEIRD_ROUTE_CAPTURE` | Screenshot the window to a PNG and exit | no — always refuses |
| `WEIRD_ROUTE_FAILSAFE_MS` | Shorten the 120 s teardown timer | no — only refuses sooner |
| `TEST_MODE` | Gate every tool regardless of the route flag | no — only gates more |

The first two can manufacture a Proceed with no window ever appearing, which is a
working bypass of the entire gate. They are inert unless `WEIRD_ROUTE_DEV=1` is also
set, and announce themselves on stderr when active. This matters because Claude Code's
settings support an `env` block injected into every hook — without the extra flag, one
approved write to `.claude/settings.local.json` would disable the gate permanently and
silently.

## How it works

```
hooks/gate.mjs          UserPromptSubmit, PreToolUse, Stop, Notification enter here
src/geometry.mjs        every pixel value, declared once
src/nav.mjs             interaction rules, as pure functions
src/job.mjs             what Noelle says, and whether a box is warranted
src/decide.mjs          choice -> hook decision
src/state.mjs           route flag and the auto-continue counter
src/transcript.mjs      harvests the NEXT: marker (a string read, never a model call)
src/renderer-client.mjs spawns the renderer, enforces the timeout
renderer/popup/         the Electron window
state/<session>.json    per-session route state
```

`gate.mjs` draws nothing. It decides whether a box is warranted, hands a job to the
renderer over stdin, and maps the answer back to a hook decision. The renderer reads
one JSON job and writes one `{"choice":"proceed"|"refuse"}`. That contract is the
whole boundary — a terminal renderer can replace the Electron one without touching
`src/`.

**Everything fails closed.** A renderer crash, a window that will not open, malformed
output, a timeout, damaged state, an empty options list — all resolve to Refuse. A
gate that fails open silently hands Claude unrestricted tool access, which is worse
than the plugin not working at all.

The plugin makes **no model calls**. The `NEXT:` marker is read from the transcript as
a plain string.
