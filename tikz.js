"use strict";

// TikZ export using explicit coordinates: every node is placed exactly where the
// editor's layout put it, and edges are straight lines between node names (TikZ
// clips them at the node borders). Ovals are sized by TikZ to the typeset label,
// since the browser cannot know how wide e.g. `$x_1$` will be once typeset.
//
// Labels are passed through as raw LaTeX. Multi-line labels become `a \\ b`.
//
// Input:
//   tree       { id, label, children }
//   positions  Map id -> { x, y } in editor pixels (y grows downward)
//   options    { pxPerCm = 45, standalone = false }

// Node style shared by the export and the editor, so ovals look the same in both.
const TIKZ_NODE = {
  innerSepPt: 2,     // space between the text box and the oval's bounding box
  minSizeCm: 0.8,    // minimum width and height of every oval
  baselinePt: 12,    // distance between lines of a multi-line label (10pt text)
  firstLinePt: 7,    // height of one line's text box (cap height of 10pt text, approx.)
  lineWidthPt: 0.4,  // TikZ's default line width
};

const TIKZ_NODE_STYLE =
  `ellipse, draw, align=center, inner sep=${TIKZ_NODE.innerSepPt}pt, ` +
  `minimum width=${TIKZ_NODE.minSizeCm}cm, minimum height=${TIKZ_NODE.minSizeCm}cm`;

const PT_PER_CM = 72.27 / 2.54;

// Size of the oval TikZ draws for a text box of the given size (all in pt).
// TikZ's `ellipse` shape passes through the corners of the text box enlarged by
// `inner sep`, so each semi-axis is sqrt(2) times that box's half-size. The minimum
// size applies to the shape itself; the outer size also includes the line width.
function tikzOvalSize(textWidthPt, textHeightPt) {
  const { innerSepPt, minSizeCm, lineWidthPt } = TIKZ_NODE;
  const min = minSizeCm * PT_PER_CM;
  const axis = (text) => Math.max(min, Math.SQRT2 * (text + 2 * innerSepPt));
  return {
    width: axis(textWidthPt) + lineWidthPt,
    height: axis(textHeightPt) + lineWidthPt,
  };
}

// Height (pt) of the text box of a label with `lines` lines.
function tikzTextHeight(lines) {
  return (lines - 1) * TIKZ_NODE.baselinePt + TIKZ_NODE.firstLinePt;
}

function toTikz(tree, positions, { pxPerCm = 45, standalone = false } = {}) {
  const num = (v) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? "0" : String(r);
  };
  const label = (text) => text.split("\n").join(" \\\\ ");

  const nodes = [];
  const edges = [];
  (function walk(node) {
    const { x, y } = positions.get(node.id);
    // Editor y grows downward; TikZ y grows upward.
    nodes.push(`  \\node (${node.id}) at (${num(x / pxPerCm)}, ${num(-y / pxPerCm)}) {${label(node.label)}};`);
    for (const child of node.children) {
      edges.push(`  \\draw (${node.id}) -- (${child.id});`);
      walk(child);
    }
  })(tree);

  const picture = [
    `\\begin{tikzpicture}[every node/.style={${TIKZ_NODE_STYLE}}]`,
    ...nodes,
    ...edges,
    "\\end{tikzpicture}",
  ].join("\n");

  if (!standalone) {
    return `% Requires \\usepackage{tikz} and \\usetikzlibrary{shapes.geometric}\n${picture}\n`;
  }
  return [
    "\\documentclass[tikz,border=5pt]{standalone}",
    "\\usetikzlibrary{shapes.geometric}",
    "\\begin{document}",
    picture,
    "\\end{document}",
    "",
  ].join("\n");
}

if (typeof module !== "undefined") {
  module.exports = { toTikz, tikzOvalSize, tikzTextHeight, TIKZ_NODE, PT_PER_CM };
}
