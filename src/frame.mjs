// The inline box, built as an array of strings.
//
// Pure, and deliberately so. The popup's equivalent lives in box.mjs, which is
// a classic script that node --test cannot reach, so every rendering bug there
// had to be caught by screenshotting a real window. This renderer is a function
// from a job to strings, and the tests read the strings.
import {
  TEXT_COLS, TEXT_ROWS, PAD, GUTTER, OPTION_COL, SOUL_GAP_COLS,
  RESET, fg, bg, WHITE, BLACK, RED, CORNER,
} from "./cells.mjs";
import { cellWidth } from "./sprite.mjs";

const FRAME = "█";
const SOUL = "♥";

// A cell is a character and the colour to draw it in. Rows are assembled as
// cells and painted at the end, so colour codes land only where the colour
// changes rather than around every character.
//
// The interior is black explicitly, never by omission. A box that inherits the
// terminal's background is a different box in every colour scheme, and the one
// the game draws is black.
const cell = (ch, color = WHITE) => ({ ch, color });
const blanks = (n) => Array.from({ length: Math.max(0, n) }, () => cell(" "));

// A finished span of sprite, carrying its own colours. It is spliced in whole,
// and resets the colour tracking afterwards because what it left set is not
// something this file knows.
const span = (text) => ({ span: text, width: cellWidth(text) });

const paint = (cells) => {
  let out = bg(BLACK);
  let curFg = null;
  for (const c of cells) {
    if (c.span !== undefined) {
      out += c.span + bg(BLACK);
      curFg = null;
      continue;
    }
    const color = c.color ?? WHITE;
    if (!curFg || curFg[0] !== color[0] || curFg[1] !== color[1] || curFg[2] !== color[2]) {
      out += fg(color);
      curFg = color;
    }
    out += c.ch;
  }
  return out + RESET;
};

const write = (cells, at, text, color = WHITE) => {
  for (let i = 0; i < text.length; i++) {
    const j = at + i;
    if (j >= 0 && j < cells.length) cells[j] = cell(text[i], color);
  }
  return cells;
};

// The row of the text area that carries the choice — row 2 of the three, the
// same row index the popup uses.
const CHOICE_ROW = TEXT_ROWS - 1;

// What the text area holds on one row. Beat 2 is its own screen: her line is
// gone and only the choice remains, exactly as the popup does it.
function textRow(job, state, row) {
  const options = Array.isArray(job.options) ? job.options : [];

  if (state.beat === 2 && options.length > 0) {
    if (row !== CHOICE_ROW) return blanks(TEXT_COLS);
    const cells = blanks(TEXT_COLS);
    for (const label of options) {
      const col = OPTION_COL[label];
      if (typeof col === "number") write(cells, col, label);
    }
    // Only an option the layout knows where to place gets a soul. An
    // unplaceable one draws no soul at all rather than one at a guessed spot.
    const label = options[Number.isInteger(state.cursor) ? state.cursor : 0];
    const col = OPTION_COL[label];
    if (typeof col === "number") write(cells, col - SOUL_GAP_COLS, SOUL, RED);
    return cells;
  }

  // Her line, revealed a character at a time. The budget is spent across the
  // rows in order, so the crawl runs on through the line breaks.
  const lines = Array.isArray(job.lines) ? job.lines : [];
  let budget = Number.isInteger(state.revealed) ? state.revealed : 0;
  for (let i = 0; i < row; i++) budget -= (lines[i] ?? "").length;
  const line = typeof lines[row] === "string" ? lines[row] : "";
  return write(blanks(TEXT_COLS), 0, line.slice(0, Math.max(0, budget)));
}

// The one-pixel leftward nudge the popup gives an asterisk row has no
// equivalent here: a cell is the smallest unit a terminal can address, and the
// nudge is an eighth of one. Dropped deliberately rather than rounded up to a
// whole cell, which would exaggerate it eightfold.
export function buildFrame(job, state, layout, faceRows = []) {
  const rows = [];
  const edge = [
    cell(FRAME, CORNER),
    ...Array.from({ length: layout.innerCols }, () => cell(FRAME, WHITE)),
    cell(FRAME, CORNER),
  ];

  // The corner dots are baked into the border art in the popup. Here they are
  // the four corners of the frame, in the colour geometry.mjs declares.
  rows.push(paint(edge));

  for (let r = 0; r < layout.innerRows; r++) {
    const line = [cell(FRAME, WHITE), ...blanks(PAD)];

    if (layout.faceCols > 0) {
      const face = faceRows[r];
      if (typeof face === "string") {
        line.push(span(face));
        line.push(...blanks(layout.faceCols - cellWidth(face)));
      } else {
        line.push(...blanks(layout.faceCols));
      }
      line.push(...blanks(GUTTER));
    }

    const textIdx = r - layout.textRow;
    line.push(...(textIdx >= 0 && textIdx < TEXT_ROWS
      ? textRow(job, state, textIdx)
      : blanks(TEXT_COLS)));

    line.push(...blanks(PAD), cell(FRAME, WHITE));
    rows.push(paint(line));
  }

  rows.push(paint(edge));
  return rows;
}

export { paint, blanks, write, span, cell, CHOICE_ROW, FRAME, SOUL };
