# Deltarune Weird Route

[![tests](https://github.com/VillaKeth/deltarune-weird-route-claude-plugin/actions/workflows/test.yml/badge.svg)](https://github.com/VillaKeth/deltarune-weird-route-claude-plugin/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

Without them the gate still runs and still fails closed: a missing `border.png` or
portrait makes the renderer refuse rather than draw half a box, so **every gated tool
call is denied** until the files are in place. That is the intended behaviour, not a
crash — but it looks like one if you skip this step. Missing sound effects are the
exception and are ignored, because a silent box is cosmetic.

### Registering the hooks

Two ways, and you want **exactly one of them**. Both register the same four hooks,
so running both means two boxes for every single gate.

**This repository only** — nothing to install, works already:
`.claude/settings.json` registers the hooks against `$CLAUDE_PROJECT_DIR`, so they
fire when the project directory *is* this checkout.

**Every project** — install it as a plugin. Install from **git**, not from this
directory:

```powershell
claude plugin marketplace add VillaKeth/deltarune-weird-route-claude-plugin
claude plugin install deltarune-weird-route@deltarune-weird-route
```

Then delete the `hooks` block from `.claude/settings.json`, or this checkout gets
gated twice.

> **Do not install from a local path.** `claude plugin marketplace add <dir>` copies
> the entire working tree into the plugin cache and **ignores `.gitignore`**. Measured
> here: 625 files and 15.4 MB, including `assets/` — copyrighted material this repo
> deliberately keeps out of git — and `.claude/settings.local.json`, which carries
> `"defaultMode": "bypassPermissions"`. A plugin whose job is gating autonomy must
> not ship a permission bypass. A git install carries committed files only.
>
> (`claude plugin marketplace add .` is also rejected outright — a bare `.` is not a
> recognised source format. It wants `owner/repo`, a URL, or `./path`.)

Installation also keeps working after it says it is done: it runs `npm install`,
which fetches the ~350 MB Electron binary. Gates that fire before that finishes
cannot resolve Electron and refuse — safe, but everything refuses until it lands.

For a single session without installing anything:

```powershell
claude --plugin-dir "C:\path\to\Deltarune Weird Route Claude Code Wrapper"
```

The plugin keeps its per-session state in `CLAUDE_PLUGIN_DATA` when Claude Code
provides it, and in `state/` beside the source when run from a checkout. The install
directory is replaced on update, so a live route would otherwise reset itself.

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

## Two renderers

The box can be drawn either in its own window or in the terminal you are already
sitting in. Both speak the same contract, so switching is one environment variable.

```powershell
$env:WEIRD_ROUTE_RENDERER = "inline"     # in the terminal
$env:WEIRD_ROUTE_RENDERER = "popup"      # the Electron window (default)
```

| | popup | inline |
|---|---|---|
| Needs Electron | yes | no |
| Sound effects | yes | no — a terminal has no audio |
| Noelle | the real PNG | the real PNG, as half-block cells |
| Covers your work | a window on top | takes the screen for the scene, then gives it back |

The inline renderer needs no wrapper process, no PTY and no native dependency. A
hook's stdio is piped, but the process can still open the real console directly —
`\\.\CONOUT$` and `\\.\CONIN$` on Windows, `/dev/tty` elsewhere — so it draws to
the terminal Claude Code is running in without proxying anything.

She is drawn at full resolution where there is room, using `▀` with a foreground
and background colour so one cell carries two stacked pixels and the sprite keeps
its aspect. In a smaller terminal she shrinks by whole numbers only, because the
faces are two-tone line art and a fractional resample turns the one-pixel outlines
grey. Below a quarter size she is dropped rather than smudged, and the text — the
part carrying the actual decision — keeps its full width.

```powershell
node tools/show-inline.mjs               # see it, no gate involved
node tools/show-inline.mjs --beat 1      # her line rather than the choice
node tools/show-inline.mjs --plain       # no colour, for reading structure
```

## Where the box appears

Dead centre is the game-accurate placement, and it lands on top of whatever you are
working on. Set `WEIRD_ROUTE_POS` to move it:

```powershell
$env:WEIRD_ROUTE_POS = "bottom-right"
```

`center` (default), `top-left`, `top-right`, `bottom-left`, `bottom-right`. Concurrent
boxes cascade from there so none can hide underneath another. Corner placements
cascade *inward*: a box sitting 24 px from an edge has only 24 px of room, and
stepping outward would walk it off the display.

With more than one monitor the box opens on the display holding the **mouse cursor**,
which is the only proxy available — Electron cannot ask which display holds the
terminal that spawned it. If your cursor habitually rests on a different screen from
the terminal you type in, use the inline renderer, which draws in the terminal itself
and cannot land on the wrong monitor by construction.

### Spanned displays

NVIDIA Surround, AMD Eyefinity and some KVMs stitch several physical panels into
**one logical display**. Windows then reports a single desktop and Electron agrees —
measured here, two 1920x1080 DELL SE2425H on a Quadro P1000 arrive as one 3840x1080
display named `WinDisc`, with `display count: 1`.

Picking a display is meaningless in that case, because there is only one. Centring it
is worse: dead centre of a 3840-wide desktop is x=1475, and the bezel is at x=1920, so
the 891 px box was cut almost exactly in half — 445 px on the left panel, 446 px on the
right.

The box now splits a spanned desktop back into equal panels and centres inside the one
holding the **mouse cursor**. Within a single spanned display the cursor is finally a
reliable signal, because the panels share one coordinate space, so cursor x alone names
the screen. With no usable cursor it uses the leftmost panel — wholly on one screen
beats sliced down the middle.

Detection is the ratio of the work area, rounded: 3840x1032 is 2.09 panels wide, so
two. A genuine 3440x1440 ultrawide is 1.39, so one, and is left centred exactly as
before. The threshold that falls out is 2.67:1. A 32:9 super-ultrawide (5120x1440) is
above it and will be treated as two panels — the box sits centred in one half rather
than dead centre, still wholly on screen.

Corner placements are deliberately **not** panel-relative: they still address the whole
desktop, which leaves `top-left`/`bottom-left` meaning the left panel and
`top-right`/`bottom-right` the right one. That is the only way to name a specific screen
once the OS has collapsed them into one.

## Develop

```powershell
npm test                    # 173 tests, node --test
node tools/show-box.mjs     # see the box without a gate
```

Twelve of those spawn the real Electron window and need `assets/` to draw. Without
the assets they report as **skipped**, never as passed — a renderer with no border
art refuses, and several of those cases expect a refusal, so a pass would mean
nothing. A clean clone therefore runs 161 and skips 12, which is what CI does.

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
| `WEIRD_ROUTE_KEYS` | Replay real key events through either renderer | **yes** — needs `_DEV=1` |
| `WEIRD_ROUTE_RENDERER` | `inline` or `popup` | no — both still ask |
| `WEIRD_ROUTE_RENDERER_ENTRY` | Point the gate at a different renderer entry | no — a bad path refuses |
| `WEIRD_ROUTE_CAPTURE` | Screenshot the window to a PNG and exit | no — always refuses |
| `WEIRD_ROUTE_INLINE_CAPTURE` | Write inline frames to a file, touching no console | no — headless refuses |
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
.claude-plugin/         plugin manifest, and the marketplace that publishes it
hooks/hooks.json        which events reach the gate, for a plugin install
hooks/gate.mjs          UserPromptSubmit, PreToolUse, Stop, Notification enter here
src/geometry.mjs        every pixel value, declared once
src/cells.mjs           every cell value, derived from the pixel values
src/window-place.mjs    where the popup lands, clamped to one display
src/nav.mjs             interaction rules, as pure functions
src/scene.mjs           the inline scene, as a reducer
src/keys.mjs            console bytes -> key names
src/frame.mjs           the inline box, as strings
src/sprite.mjs          a PNG -> half-block cells
src/png.mjs             a dependency-free PNG decoder
src/job.mjs             what Noelle says, and whether a box is warranted
src/decide.mjs          choice -> hook decision
src/state.mjs           route flag and the auto-continue counter
src/transcript.mjs      harvests the NEXT: marker (a string read, never a model call)
src/renderer-client.mjs spawns the renderer, enforces the timeout
renderer/popup/         the Electron window
renderer/inline/        the terminal takeover
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

## License

The code is MIT licensed — see [LICENSE](LICENSE). Copyright © 2026 VillaKeth.

**The MIT licence covers this repository's code and nothing else.** Deltarune, its
sprites, its font and its sound effects are the property of Toby Fox. None of that
material is in this repository, none of it is redistributed here, and no permission to
use it is granted or implied by the licence above. The `assets/` directory you supply
is yours to source, and the terms attached to it are Toby Fox's, not mine. This is an
unofficial fan project with no affiliation with or endorsement by Toby Fox.
