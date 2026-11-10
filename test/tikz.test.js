"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { layoutTree } = require("../layout.js");
const { toTikz, tikzOvalSize, tikzTextHeight } = require("../tikz.js");

function t(spec) {
  const [id, label, ...kids] = spec;
  return { id, label, children: kids.map(t) };
}
function ids(n, out = []) { out.push(n.id); n.children.forEach((c) => ids(c, out)); return out; }

const tree = t(["n1", "root", ["n2", "$x_1$", ["n4", "leaf"]], ["n3", "two\nlines"], ["n5", ""]]);
const widths = new Map(ids(tree).map((id) => [id, 40]));
const heights = new Map(ids(tree).map((id) => [id, id === "n3" ? 70 : 36]));
const positions = layoutTree(tree, widths, { gap: 16, rowGap: 34, heights });

test("places every node at its layout position, converted to cm with y flipped", () => {
  const out = toTikz(tree, positions, { pxPerCm: 50 });
  assert.match(out, /\\node \(n1\) at \(0, 0\) \{root\};/);
  const p = positions.get("n4");
  assert.ok(out.includes(`\\node (n4) at (${Math.round(p.x / 50 * 100) / 100}, ${Math.round(-p.y / 50 * 100) / 100}) {leaf};`));
});

test("draws one edge per parent-child pair", () => {
  const out = toTikz(tree, positions);
  const edges = out.match(/\\draw/g);
  assert.equal(edges.length, 4);
  assert.ok(out.includes("\\draw (n2) -- (n4);"));
});

test("passes LaTeX through, joins lines with \\\\, keeps empty labels", () => {
  const out = toTikz(tree, positions);
  assert.ok(out.includes("{$x_1$};"));
  assert.ok(out.includes("{two \\\\ lines};"));
  assert.match(out, /\\node \(n5\) at \([^)]*\) \{\};/);
});

test("standalone output is a complete document", () => {
  const out = toTikz(tree, positions, { standalone: true });
  assert.match(out, /^\\documentclass/);
  assert.ok(out.includes("\\usetikzlibrary{shapes.geometric}"));
  assert.ok(out.trimEnd().endsWith("\\end{document}"));
});

const hasPdflatex = spawnSync("pdflatex", ["--version"]).status === 0;
test("standalone output compiles with pdflatex", { skip: !hasPdflatex && "pdflatex not installed" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tikz-tree-"));
  fs.writeFileSync(path.join(dir, "tree.tex"), toTikz(tree, positions, { standalone: true }));
  execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "tree.tex"], { cwd: dir, stdio: "pipe" });
  assert.ok(fs.existsSync(path.join(dir, "tree.pdf")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tikzOvalSize matches the ovals TikZ actually draws", { skip: !hasPdflatex && "pdflatex not installed" }, () => {
  // For each label, have LaTeX report the plain text width and the drawn node's size.
  // Multi-line labels start with a tall letter: LaTeX's text box height depends on the
  // letters actually used (e.g. "a" is ~2.7pt shorter than "t"), which the editor can't
  // know, so tikzTextHeight assumes tall letters and errs slightly large.
  const labels = ["leaf", "root", "hello world", "a much longer label", "x", "two \\\\ lines", "the \\\\ big \\\\ cat"];
  const doc = String.raw`\documentclass{article}
\usepackage{tikz}\usetikzlibrary{shapes.geometric,calc}
\begin{document}
\newcommand\linewidthof[2]{\setbox0=\hbox{#2}\typeout{LINE #1 \the\wd0}}
\newcommand\nodesize[2]{%
  \begin{tikzpicture}[every node/.style={ellipse, draw, align=center, inner sep=2pt, minimum width=0.8cm, minimum height=0.8cm}]
    \node (n) {#2};
    \path let \p1=($(n.east)-(n.west)$), \p2=($(n.north)-(n.south)$) in
      \pgfextra{\typeout{NODE #1 \x1\space\y2}};
  \end{tikzpicture}}
` + labels.map((l, i) =>
    l.split(" \\\\ ").map((line) => `\\linewidthof{${i}}{${line}}`).join("\n") + `\n\\nodesize{${i}}{${l}}`,
  ).join("\n") + "\n\\end{document}\n";

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tikz-tree-"));
  fs.writeFileSync(path.join(dir, "m.tex"), doc);
  spawnSync("pdflatex", ["-interaction=nonstopmode", "m.tex"], { cwd: dir });
  const log = fs.readFileSync(path.join(dir, "m.log"), "utf8");
  fs.rmSync(dir, { recursive: true, force: true });

  const textWidth = new Map();
  for (const [, i, w] of log.matchAll(/^LINE (\d+) ([\d.]+)pt$/gm)) {
    textWidth.set(i, Math.max(textWidth.get(i) ?? 0, parseFloat(w)));
  }
  const nodes = [...log.matchAll(/^NODE (\d+) ([\d.]+)pt ([\d.]+)pt$/gm)];
  assert.equal(nodes.length, labels.length, "every label measured");
  for (const [, i, nodeW, nodeH] of nodes) {
    const lines = labels[i].split(" \\\\ ").length;
    const expected = tikzOvalSize(textWidth.get(i), tikzTextHeight(lines));
    assert.ok(Math.abs(expected.width - parseFloat(nodeW)) < 0.05,
      `${labels[i]}: width ${expected.width} vs TikZ ${nodeW}`);
    assert.ok(Math.abs(expected.height - parseFloat(nodeH)) < 1.5,
      `${labels[i]}: height ${expected.height} vs TikZ ${nodeH}`);
  }
});
