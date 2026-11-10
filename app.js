"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";

// Scale between the editor and LaTeX: 45px per cm makes 16px editor text about
// the size of 10pt LaTeX text. Ovals are sized with TikZ's own rule (tikz.js), so
// they look the same in the editor and in the PDF.
const PX_PER_CM = 45;
const PX_PER_PT = PX_PER_CM / PT_PER_CM;
const FONT_SIZE = 16;
const LINE_HEIGHT = TIKZ_NODE.baselinePt * PX_PER_PT;
const ROW_GAP = 34;      // vertical space between rows (single-line rows end up 70px apart)
const SIBLING_GAP = 16;  // minimum horizontal space between neighbouring ovals
const ROOT_TOP = 60;     // root's distance from the top of the window
const MAX_ORDERINGS = 100_000; // brute-force limit for "Optimize order"

const layoutOptions = () => ({ gap: SIBLING_GAP, rowGap: ROW_GAP, heights: state.heights });

// ---- State ----------------------------------------------------------------

const state = {
  tree: { id: "n1", label: "root", children: [] },
  selectedId: null,
  // Node whose label is open in the text box. Typing changes the label directly.
  editingId: null,
  // Whether the current editing session has already recorded an undo step, so a
  // whole session (or adding a node and naming it) is undone in one go.
  editRecorded: false,
  nextId: 2,
  // Oval sizes measured by the last render (id -> px), reused by the optimiser.
  widths: new Map(),
  heights: new Map(),
  // Node centres from the last render (id -> { x, y }), used by the TikZ export.
  positions: new Map(),
  // Snapshots of { tree, selectedId } for undo and redo.
  undoStack: [],
  redoStack: [],
};

function findNode(id, node = state.tree) {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(id, child);
    if (found) return found;
  }
  return null;
}

function findParent(id, node = state.tree) {
  for (const child of node.children) {
    if (child.id === id) return node;
    const found = findParent(id, child);
    if (found) return found;
  }
  return null;
}

// ---- Undo / redo ----------------------------------------------------------

function snapshot() {
  return { tree: structuredClone(state.tree), selectedId: state.selectedId };
}

// Call just before changing the tree. Any new change discards the redo history.
function recordChange() {
  state.undoStack.push(snapshot());
  state.redoStack = [];
  updateUndoButtons();
}

function restoreFrom(from, to) {
  if (from.length === 0) return;
  to.push(snapshot());
  const s = from.pop();
  state.tree = s.tree;
  state.selectedId = s.selectedId;
  updateUndoButtons();
  render();
}

const undo = () => restoreFrom(state.undoStack, state.redoStack);
const redo = () => restoreFrom(state.redoStack, state.undoStack);

// ---- DOM ------------------------------------------------------------------

const canvas = document.getElementById("canvas");
const viewport = document.getElementById("viewport");
const edgesLayer = document.getElementById("edges");
const nodesLayer = document.getElementById("nodes");
const editor = document.getElementById("label-editor");

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function nodeElement(id) {
  return nodesLayer.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
}

// ---- Rendering ------------------------------------------------------------

// Creates a node's SVG group (unpositioned), sizes its oval to the label, and
// returns the oval's full { width, height }.
function createNode(node) {
  const g = svgEl("g", { class: "node" });
  g.dataset.id = node.id;
  if (node.id === state.selectedId) g.classList.add("selected");
  if (node.id === state.editingId) g.classList.add("editing");

  // One <tspan> per line, stacked and centred vertically on the node.
  const lines = node.label.split("\n");
  const ellipse = svgEl("ellipse");
  const text = svgEl("text");
  lines.forEach((line, i) => {
    const tspan = svgEl("tspan", {
      x: 0,
      y: (i - (lines.length - 1) / 2) * LINE_HEIGHT,
      "dominant-baseline": "central",
    });
    tspan.textContent = line;
    text.append(tspan);
  });
  g.append(ellipse, text);
  nodesLayer.append(g);

  // Measure the label once it is in the document, then size the oval exactly as
  // TikZ would for a text box of that size.
  const textWidthPt = text.getBBox().width / PX_PER_PT;
  const size = tikzOvalSize(textWidthPt, tikzTextHeight(lines.length));
  const width = size.width * PX_PER_PT;
  const height = size.height * PX_PER_PT;
  ellipse.setAttribute("rx", width / 2);
  ellipse.setAttribute("ry", height / 2);
  g.dataset.rx = width / 2;
  return { width, height };
}

function eachNode(node, fn) {
  fn(node);
  node.children.forEach((c) => eachNode(c, fn));
}

// Three passes: measure every label, lay the tree out, then position nodes and draw edges.
function render() {
  nodesLayer.replaceChildren();
  edgesLayer.replaceChildren();

  state.widths = new Map();
  state.heights = new Map();
  eachNode(state.tree, (node) => {
    const { width, height } = createNode(node);
    state.widths.set(node.id, width);
    state.heights.set(node.id, height);
  });

  const pos = layoutTree(state.tree, state.widths, layoutOptions());
  state.positions = pos;

  eachNode(state.tree, (node) => {
    const p = pos.get(node.id);
    nodeElement(node.id).setAttribute("transform", `translate(${p.x},${p.y})`);
    for (const child of node.children) {
      const c = pos.get(child.id);
      edgesLayer.append(svgEl("line", { x1: p.x, y1: p.y, x2: c.x, y2: c.y }));
    }
  });

  positionEditor();
  updateExport();
}

// Pin the root near the top centre; the tree grows downward from there.
function centreViewport() {
  const { width } = canvas.getBoundingClientRect();
  viewport.setAttribute("transform", `translate(${width / 2},${ROOT_TOP})`);
}

// ---- Label editor ---------------------------------------------------------

// Place the text box exactly over the label being edited, in screen pixels.
// Uses the node's screen transform, so it will keep working once pan/zoom exist.
function positionEditor() {
  if (state.editingId === null) return;
  const g = nodeElement(state.editingId);
  const m = g.getScreenCTM();
  const scale = m.a;
  const lines = editor.value.split("\n").length;
  const width = 2 * Number(g.dataset.rx) * scale;
  const height = lines * LINE_HEIGHT * scale;
  Object.assign(editor.style, {
    left: `${m.e - width / 2}px`,
    top: `${m.f - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    fontSize: `${FONT_SIZE * scale}px`,
    lineHeight: `${LINE_HEIGHT * scale}px`,
  });
}

// Change the label of the node being edited. The first change in an editing
// session records one undo step for the whole session.
function setEditingLabel(text) {
  const node = findNode(state.editingId);
  if (node.label === text) return;
  if (!state.editRecorded) {
    recordChange();
    state.editRecorded = true;
  }
  node.label = text;
}

// mode "select-all": open with the current label selected (double-click, F2).
// mode "replace":    replace the label with `initialText` (type-to-edit).
function startEdit(id, mode, initialText = "") {
  state.selectedId = id;
  state.editingId = id;
  state.editRecorded = false;
  if (mode === "replace") setEditingLabel(initialText);

  editor.value = findNode(id).label;
  editor.hidden = false;
  render();
  editor.focus();
  if (mode === "select-all") editor.select();
  else editor.setSelectionRange(editor.value.length, editor.value.length);
}

// Close the text box. Nothing to save: every keystroke already changed the tree.
function finishEdit() {
  if (state.editingId === null) return;
  state.editingId = null;
  editor.hidden = true; // may fire blur, which is a no-op now editingId is null
  render();
}

// ---- Tree edits -----------------------------------------------------------

// Append an empty child to `parentId`, select it, and start editing its label.
function addChild(parentId) {
  recordChange();
  const child = { id: `n${state.nextId++}`, label: "", children: [] };
  findNode(parentId).children.push(child);
  startEdit(child.id, "replace", "");
  state.editRecorded = true; // naming the new node is part of the "add" step
}

// Remove a node and its whole subtree, then select its parent.
// The root has no parent and cannot be deleted.
function deleteNode(id) {
  const parent = findParent(id);
  if (!parent) return;
  recordChange();
  parent.children = parent.children.filter((c) => c.id !== id);
  state.selectedId = parent.id;
  render();
}

// ---- Undo / redo buttons --------------------------------------------------

const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");

function updateUndoButtons() {
  undoBtn.disabled = state.undoStack.length === 0;
  redoBtn.disabled = state.redoStack.length === 0;
}

undoBtn.addEventListener("click", () => {
  undoBtn.blur();
  undo();
});

redoBtn.addEventListener("click", () => {
  redoBtn.blur();
  redo();
});

// ---- Optimize order -------------------------------------------------------

const optimizeBtn = document.getElementById("optimize-btn");
const statusEl = document.getElementById("status");
let statusTimer = null;

function showStatus(message, warn = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("warn", warn);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 6000);
}

const fmt = (n) => (Number.isFinite(n) && n < 1e15 ? n.toLocaleString() : n.toExponential(1));

optimizeBtn.addEventListener("click", () => {
  optimizeBtn.blur(); // so Enter/Space afterwards don't press it again

  const count = countOrderings(state.tree);
  if (count > MAX_ORDERINGS) {
    showStatus(
      `Too many orderings to optimize: ${fmt(count)} (limit ${fmt(MAX_ORDERINGS)}).`,
      true,
    );
    return;
  }

  const { best, current, tried, orders } = optimizeOrder(state.tree, state.widths, layoutOptions());
  if (best >= current) {
    showStatus(`Already the narrowest order (checked ${fmt(tried)} orderings).`);
    return;
  }

  // Apply the winning child order to every internal node.
  recordChange();
  eachNode(state.tree, (node) => {
    const order = orders.get(node.id);
    if (!order) return;
    const byId = new Map(node.children.map((c) => [c.id, c]));
    node.children = order.map((id) => byId.get(id));
  });
  render();
  showStatus(
    `Width ${Math.round(current)}px → ${Math.round(best)}px (checked ${fmt(tried)} orderings).`,
  );
});

// ---- TikZ export ----------------------------------------------------------

const exportBtn = document.getElementById("export-btn");
const exportPanel = document.getElementById("export-panel");
const exportCode = document.getElementById("export-code");
const exportStandalone = document.getElementById("export-standalone");
const exportCopy = document.getElementById("export-copy");
const exportClose = document.getElementById("export-close");

// Regenerated on every render while the panel is open, so it always matches the canvas.
function updateExport() {
  if (exportPanel.hidden) return;
  exportCode.value = toTikz(state.tree, state.positions, {
    pxPerCm: PX_PER_CM,
    standalone: exportStandalone.checked,
  });
}

exportBtn.addEventListener("click", () => {
  exportBtn.blur();
  exportPanel.hidden = !exportPanel.hidden;
  updateExport();
});

exportClose.addEventListener("click", () => (exportPanel.hidden = true));
exportStandalone.addEventListener("change", updateExport);

exportCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportCode.value);
    showStatus("TikZ copied to clipboard.");
  } catch {
    // Clipboard API can be blocked (e.g. on file:// pages); fall back to selecting.
    exportCode.focus();
    exportCode.select();
    showStatus("Select-all done — press Ctrl+C to copy.");
  }
});

// ---- Text box -------------------------------------------------------------

// Every keystroke goes straight into the tree, which re-renders to fit.
editor.addEventListener("input", () => {
  setEditingLabel(editor.value);
  render();
});

// Enter is left alone, so it inserts a new line.
editor.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    finishEdit();
  } else if (e.key === "Tab") {
    // Close this label and go straight on to typing a child of this node.
    e.preventDefault();
    const id = state.editingId;
    finishEdit();
    addChild(id);
  }
});

// Clicking anywhere else (or switching window) closes the text box.
editor.addEventListener("blur", () => finishEdit());

// ---- Selection & shortcuts ------------------------------------------------

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  render();
}

canvas.addEventListener("click", (e) => {
  const nodeEl = e.target.closest(".node");
  select(nodeEl ? nodeEl.dataset.id : null);
});

canvas.addEventListener("dblclick", (e) => {
  const nodeEl = e.target.closest(".node");
  if (nodeEl) startEdit(nodeEl.dataset.id, "select-all");
});

document.addEventListener("keydown", (e) => {
  // While typing a label, keys belong to the text box (Ctrl+Z there undoes typing).
  if (state.editingId !== null) return;
  // Likewise for the export panel's controls: Backspace there must not delete a node.
  if (e.target.closest("input, textarea, button, select")) return;

  // Undo / redo work with or without a selection.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      redo();
      return;
    }
  }

  if (state.selectedId === null) return;

  if (e.key === "F2") {
    e.preventDefault();
    startEdit(state.selectedId, "select-all");
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault(); // keep focus from leaving the canvas
    addChild(state.selectedId);
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteNode(state.selectedId);
    return;
  }

  // Typing a printable character replaces the label, like a spreadsheet cell.
  const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (printable) {
    e.preventDefault();
    startEdit(state.selectedId, "replace", e.key);
  }
});

window.addEventListener("resize", () => {
  centreViewport();
  positionEditor();
});

// ---- Start ----------------------------------------------------------------

centreViewport();
render();
