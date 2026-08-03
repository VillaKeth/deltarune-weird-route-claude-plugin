// Cell geometry for the inline renderer.
//
// geometry.mjs owns every PIXEL value and this file owns every CELL value.
// Nothing here restates a pixel: each constant below is derived from the
// declared pixel geometry by the only two ratios that connect the two spaces —
// BOX.advance px per column, and two source pixels per row because a half-block
// cell stacks two of them.
//
// The two axes genuinely do not share a scale. Text is 8 px per column, but the
// sprite is 1 px per column, and the sprite would be illegible at an eighth of
// its width. So the box is composed in cells rather than scaled from pixels,
// and only the RELATIONSHIPS are carried across.
import { BOX, MAX_CHARS, MAX_ROWS, OPTION_X } from "./geometry.mjs";

// A half-block cell shows two vertically stacked source pixels.
export const PX_PER_ROW = 2;

export const TEXT_COLS = MAX_CHARS.withPortrait;
export const TEXT_ROWS = MAX_ROWS;

// One blank cell inside the frame, and the channel between sprite and text.
export const PAD = 1;
export const GUTTER = 2;

// Where each label sits, as an offset in characters from the start of the text
// area. The pixel positions divided by the character advance — the same
// relationship the popup uses, expressed in the unit this renderer draws in.
export const OPTION_COL = Object.freeze(
  Object.fromEntries(Object.entries(OPTION_X).map(
    ([label, x]) => [label, Math.round((x - BOX.textX.withPortrait) / BOX.advance)])));

// The soul sits its own width plus the declared gap to the left of its label.
// One cell is one character, so that distance in characters is the distance in
// cells, rounded up so the soul never overlaps the first glyph.
export const SOUL_GAP_COLS = Math.ceil((BOX.soul + BOX.soulGap) / BOX.advance);

export const RESET = "\x1b[0m";
export const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
export const bg = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`;

export const WHITE = Object.freeze([255, 255, 255]);
export const BLACK = Object.freeze([0, 0, 0]);
export const RED = Object.freeze([255, 0, 0]);

// The corner colour is declared once, in geometry.mjs, as a CSS string because
// that is what the page needs. Parsed rather than retyped as a triple.
export const CORNER = Object.freeze(
  BOX.cornerColor.match(/\d+/g).map(Number));

// Past a quarter size she stops being a face and becomes a smudge. Without a
// floor the search happily returns a divisor of 56, which "fits" by arithmetic:
// a one-cell portrait.
export const MAX_DIVISOR = 4;

// The smallest whole-number divisor that fits the sprite in the space
// available. Whole numbers only: the faces are two-tone line art, and a
// fractional divisor resamples the one-pixel outlines into grey mush.
export function spriteDivisor(available, { faceW = BOX.face.w, faceH = BOX.face.h } = {}) {
  const { cols, rows } = available;
  for (let d = 1; d <= MAX_DIVISOR; d++) {
    const w = Math.ceil(faceW / d);
    const h = Math.ceil(faceH / (d * PX_PER_ROW));
    if (w <= cols && h <= rows) return d;
  }
  return 0;   // no divisor fits: the caller draws no face at all
}

// Everything the frame builder needs to place a cell. `term` is the terminal's
// own size, which the layout must fit inside — a box wider than the window
// wraps, and a wrapped box is unreadable.
export function layout(term = { cols: 80, rows: 24 }, { withFace = true } = {}) {
  // Room for the sprite once the frame, the padding, the gutter and the text
  // have taken theirs.
  const chrome = 2 + PAD * 2 + GUTTER + TEXT_COLS;
  const divisor = withFace
    ? spriteDivisor({ cols: Math.max(0, term.cols - chrome), rows: Math.max(0, term.rows - 2) })
    : 0;

  const faceCols = divisor ? Math.ceil(BOX.face.w / divisor) : 0;
  const faceRows = divisor ? Math.ceil(BOX.face.h / (divisor * PX_PER_ROW)) : 0;

  const innerCols = PAD + faceCols + (faceCols ? GUTTER : 0) + TEXT_COLS + PAD;
  const innerRows = Math.max(faceRows, TEXT_ROWS);

  return {
    divisor,
    faceCols,
    faceRows,
    innerCols,
    innerRows,
    width: innerCols + 2,
    height: innerRows + 2,
    // Column where the text area begins, measured from inside the left frame.
    textCol: PAD + faceCols + (faceCols ? GUTTER : 0),
    // A tall sprite leaves the three text rows floating; centre them against it.
    textRow: Math.max(0, Math.floor((innerRows - TEXT_ROWS) / 2)),
  };
}
