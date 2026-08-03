# Deltarune Weird Route — Claude Code Plugin

**Date:** 2026-08-03
**Status:** design approved, not yet planned

A Claude Code plugin that gates Claude's autonomy behind Deltarune's Weird Route
dialogue box. Noelle states what Claude is about to do; the player moves the soul
with the arrow keys and answers **Proceed** or **Refuse**. Proceed lets Claude keep
running on its own, the way Noelle just figures things out.

---

## Goals

- Pixel-faithful Deltarune text box: real geometry, real font, real portrait, real SFX.
- Arrow-key navigation with the soul cursor; `Z` confirm, `X` back — game controls.
- Proceed hands control back to Claude and lets it free-run.
- Refuse stops Claude and returns the terminal to the user.

## Non-goals

- Shipping any Toby Fox asset. Everything in `assets/` stays local and gitignored.
- Theming Claude Code as a whole. Only the decision moment is Deltarune.
- Cross-platform in phase 1. Windows first.

---

## Phases

**Phase 1 — popup renderer.** A borderless, always-on-top window. Terminal is
untouched, nothing competes with Claude Code's own rendering, and the sprite is a
real PNG. This is what gets built first.

**Phase 2 — inline renderer.** A `deltarune-claude` wrapper that PTY-proxies Claude
Code and blanks the terminal for the scene, then hands the screen back. Same job
contract, different renderer. Out of scope for the first implementation plan.

The renderer boundary exists specifically so phase 2 is a drop-in, not a rewrite.

---

## Architecture

```
hooks/gate.mjs         Stop, PreToolUse and Notification all enter here
renderer/popup/        phase 1 window
renderer/inline/       phase 2 terminal takeover
state/<session>.json   route active, auto-continue counter, last NEXT marker
assets/                faces, border art, font, sfx   (gitignored)
```

`gate.mjs` draws nothing. It decides whether a box is warranted, hands a job to the
configured renderer, and maps the answer back to a hook decision. Every rendering
concern lives behind the contract below.

### Renderer contract

Job on stdin:

```json
{
  "face": "trance",
  "lines": ["* Kris... it wants to", "  rewrite 14 files."],
  "options": ["Proceed", "Refuse"],
  "default": 0,
  "sfx": "start"
}
```

Answer on stdout:

```json
{ "choice": "proceed" }
```

`choice` is `proceed` or `refuse`. Any non-zero exit, malformed output, or timeout
is treated as `refuse` — see Invariants.

---

## Triggers

The box is deliberately rare. A turn that ends with a `NEXT:` marker auto-continues
silently, with no box and no keypress.

| Event | Hook | Proceed | Refuse |
|---|---|---|---|
| Consequential tool call | `PreToolUse` | `allow` the call | `deny` the call **and end the route** |
| Claude paused / waiting | `Notification` | acknowledge (see below) | end the route |
| 25 auto-continues elapsed | `Stop` | reset counter, continue | end the route |
| Turn ends with no `NEXT:` | `Stop` | route-complete box — see below | |

**Refuse always ends the route**, in every row. It is not "reject this one step and try
another" — it denies whatever was asked, stops Claude, plays the abort jingle, and
returns a normal prompt to the user. Refuse means *no, I'm driving now*.

**The route-complete box takes no choice.** When a turn ends with no `NEXT:` marker
there is nothing to proceed to, so the box shows only Noelle's closing line with no
soul and no options. `Z` or `Esc` dismisses it and the route ends. Completion is not
an abort, so it plays no jingle.

**`Notification` cannot resume anything.** Verified against the Claude Code hook
documentation: `Notification` hooks have no decision control — they exist for side
effects and cannot block or modify behaviour. An earlier draft of this spec claimed
Proceed "resumes", which was never achievable. What the box actually does on a
`Notification` is decide the route's own fate: Proceed leaves the route running so
later gates still fire, Refuse ends it. Nothing in either branch reaches Claude Code,
and the hook's output is always `{}`.

**Consequential tools:** `Write`, `Edit`, `Bash`, `WebFetch`, `Task`. `Read`, `Grep`,
`Glob` and other read-only tools never gate — gating them produces a box every few
seconds and the plugin becomes unusable. The list is user-configurable.

**The `NEXT:` marker.** Claude is instructed to end turns with a single
`NEXT: <one line>` describing its intended next step. `gate.mjs` harvests it from the
transcript. This is a plain string read — **no extra model call**, no sub-agent, no
automated model loop. If the marker is absent, the turn is treated as route-complete.

---

## Autonomy model

Proceed grants free-running: Claude continues until it hits a consequential tool call
or runs out of work. There is no wall-clock limit.

The single ceiling is **25 consecutive silent auto-continues**. On the 25th, the box
is forced back and requires an explicit Proceed, which resets the counter to zero.
The counter also resets whenever a box is shown for any other reason.

This ceiling is not a leash on normal use — it is the backstop against a loop that
never surfaces a decision point. `CLAUDE.md` records a prior session in this workspace
burning its budget on exactly that shape.

---

## Visual specification

All values are Deltarune game pixels, taken from the Deltarune border profile in
`xMirkix/yet-another-textbox-generator` and verified by decoding the border asset.

| | |
|---|---|
| Box | 297 × 84 |
| Border | 7 px |
| Portrait slot | 67 × 70 at (7, 7); right-hand slot at (223, 7) |
| Face sprite | 56 × 61, centred in the slot → offset (5, 4) |
| Font | Determination Mono Web, 16 px, 18 px line height |
| Text origin | y = 7; x = 69 with a portrait, x = 11 without |
| Rows | 3, at y = 7, 25, 43 |
| Asterisk offset | −1 |
| Corner dots | rgb(170, 255, 230) at (6,6), (290,6), (6,77), (290,77) — **baked into the border asset**, do not redraw |
| Soul | 16 × 16, drawn in code, `#ff0000` |

**Character advance is 8 px** — measured in-browser, true monospace. That gives
**27 characters per line** with a portrait and 34 without. The renderer must wrap to
this and assert no run exceeds the inner right edge (x = 290); a hardcoded guess at
the advance is what produced the first broken render.

**Z-order is load-bearing.** The border asset is a 1 px frame plus an *opaque black
block* covering only the text area, with both portrait slots cut transparent.
Measured by decoding `assets/border.png` (297×84 RGBA) along row y = 40, the alpha
runs are: x 0–3 transparent, **x 4–7 opaque** (left frame), x 8–73 transparent (left
slot), **x 74–222 opaque** (text area), x 223–288 transparent (right slot), **x
289–292 opaque** (right frame), x 293–296 transparent. The corner dots are already
painted into the asset at the four listed coordinates and are exactly
rgb(170, 255, 230) — the renderer must not draw its own.

The pipeline is **fill → sprite → border → text → soul**. The border sits *above*
the sprite (its cut-out slots let the face show through) and *below* the text (its
opaque block would otherwise hide every glyph). Drawing the border last paints the
text area black and hides everything, which is what produced the first broken render.

**Faces.** `assets/noelle/` holds eight Weird Route-tone expressions: `trance`
(default — the blank hypnotised stare), `mortified`, `mortified_stare`,
`mortified_breakingdown`, `scared`, `stunned`, `shocked`, `speechless`. Every file
is 56 × 61 RGBA and — verified by decoding all eight — contains exactly **two**
colours: rgb(255,255,255) fill and rgb(0,0,0) outline, over transparency. They are
two-tone line art, **not** masks. Draw them as-is. Applying a CSS tint or filter
destroys the black outlines and is the wrong reading of this asset.

---

## Audio

| Event | File |
|---|---|
| Route start | `ui_spooky_action.wav` (2.50 s) |
| Route abort — any Refuse | `ominous_cancel.wav` (2.11 s) |
| Route complete — no `NEXT:` | none; completion is not an abort |
| Soul moves | `ui_move.wav` (0.02 s) |
| Proceed confirmed | `ui_select.wav` (0.19 s) |
| Typewriter, per character | `voice_noelle.wav` (0.04 s) |

Spares in `assets/sfx/`: `snowgrave.ogg` (the SNOWGRAVE cast, an alternative for route
start), `icespell`, `impact`, `ominous`, `dtrans_lw`, `ui_cancel`.

---

## Interaction

Two beats in one window.

1. **She speaks.** Text types out at one character per tick with `voice_noelle`. The
   choice does not exist yet. `Z` advances, or skips the crawl if it is still running.
   `X` does nothing — the player does not get to skip her.
2. **The choice.** `←` `→` move the soul between Proceed and Refuse, each move playing
   `ui_move`. `Z` confirms with `ui_select`. `X` returns to her line.

Soul at x = 69; `Proceed` at x = 91; `Refuse` at x = 196; all on row 2 (y = 43).

---

## Invariants

**A failed box never grants permission.** Renderer crash, window that will not open,
malformed output, or timeout all resolve to **Refuse**. Fail closed. A gate that fails
open silently hands Claude unrestricted tool access, which is the one outcome worse
than the plugin not working.

**The window always has a hard teardown.** `Esc` always closes it. An independent
timer force-closes at 120 s and returns Refuse regardless of window state. Never ship
a path where a bug can leave an un-closable always-on-top window on screen.

**Assets are never committed.** `assets/` is copyrighted Toby Fox material — sprites
from `SoupTaels/UTDR-Textbox-Soup`, SFX from `KristalTeam/Kristal`, and the fan-made
Determination Mono Web font. `assets/` goes into `.gitignore` before the first commit,
not after.

**Geometry is specified once.** The constants in the Visual specification are declared
in one module and imported by every renderer. Phase 2 must not restate them.

---

## Error handling

| Failure | Behaviour |
|---|---|
| Renderer binary missing | Refuse; log once; hook exits non-blocking |
| Window fails to open | Refuse |
| Renderer times out (120 s) | Refuse; force teardown |
| Malformed renderer output | Refuse |
| Transcript unreadable | Treat as route-complete; no box |
| Asset missing | Renderer fails → Refuse. Do not render a partial box. |

---

## Testing

- **Geometry unit tests** — wrapping at 27/34 characters, no run past x = 290, rows at
  7/25/43, sprite centring offset.
- **Contract tests** — every failure row in the table above resolves to `refuse`.
- **Counter tests** — 25 auto-continues forces a box; an explicit Proceed resets it.
- **Trigger tests** — `Read`/`Grep`/`Glob` never gate; `Write`/`Edit`/`Bash` always do.
- **Manual** — a `TEST_MODE` that fires the box on the next tool call regardless of
  type, so the overlay can be seen in seconds rather than by waiting for a real gate.

---

## Open items

- **Option labels unverified.** `Proceed` / `Refuse` is from memory, not from the game
  script. Worth checking against the real Weird Route text before shipping.
- **Phase 2 renderer** is sketched, not specified. It needs its own design pass.
- `.claude/CLAUDE.md` currently describes an unrelated project ("Foxy Jumpscare") and
  needs replacing with this project's instructions.
