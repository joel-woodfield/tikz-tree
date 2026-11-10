"use strict";

// Tidy-tree layout (contour-based Reingold–Tilford).
//
// Each subtree is laid out on its own, then its children are packed left to right:
// every child subtree is pushed right until, at every depth, it is at least `gap`
// away from the subtrees already placed. The parent is centred over its first and
// last child.
//
// Known limitation: small subtrees sitting between two large ones are packed to the
// left rather than spread evenly (Walker's algorithm fixes this).
//
// Input:
//   tree    { id, children: [...] }
//   widths  Map or object: id -> full node width
//   options { gap, levelHeight } or { gap, heights, rowGap }
//     Without `heights`, rows are a fixed `levelHeight` apart (centre to centre).
//     With `heights` (Map or object: id -> node height), each row is as tall as its
//     tallest node, and rows are separated by `rowGap` (bottom of one row to the top
//     of the next). Nodes in a row are vertically centred on the row.
// Output: Map id -> { x, y }, with the root's centre at (0, 0) and y growing downward.

function layoutTree(tree, widths, { levelHeight = 70, gap = 16, heights, rowGap = 34 } = {}) {
  const widthOf = (id) => (widths instanceof Map ? widths.get(id) : widths[id]);
  const heightOf = (id) => (heights instanceof Map ? heights.get(id) : heights[id]);

  // Returns { nodes: [[id, relX, depth], ...], left: [...], right: [...] }
  // where relX is relative to this subtree's root and left/right are the
  // subtree's outline (leftmost / rightmost edge) at each depth below its root.
  function place(node) {
    const half = widthOf(node.id) / 2;

    if (node.children.length === 0) {
      return { nodes: [[node.id, 0, 0]], left: [-half], right: [half] };
    }

    const subtrees = node.children.map(place);
    const offsets = [0];
    let accLeft = subtrees[0].left.slice();
    let accRight = subtrees[0].right.slice();

    for (let i = 1; i < subtrees.length; i++) {
      const s = subtrees[i];
      // Smallest shift keeping this subtree `gap` clear of everything placed so far.
      let shift = -Infinity;
      const common = Math.min(accRight.length, s.left.length);
      for (let d = 0; d < common; d++) {
        shift = Math.max(shift, accRight[d] - s.left[d] + gap);
      }
      offsets.push(shift);

      // Merge outlines: the new subtree is now the rightmost wherever it exists,
      // and is the leftmost only at depths the earlier subtrees don't reach.
      const depth = Math.max(accRight.length, s.right.length);
      for (let d = 0; d < depth; d++) {
        if (d < s.right.length) accRight[d] = s.right[d] + shift;
        if (d >= accLeft.length) accLeft[d] = s.left[d] + shift;
      }
    }

    // Centre the parent over its first and last child.
    const centre = (offsets[0] + offsets[offsets.length - 1]) / 2;

    const nodes = [[node.id, 0, 0]];
    subtrees.forEach((s, i) => {
      for (const [id, x, depth] of s.nodes) {
        nodes.push([id, x + offsets[i] - centre, depth + 1]);
      }
    });

    return {
      nodes,
      left: [-half, ...accLeft.map((v) => v - centre)],
      right: [half, ...accRight.map((v) => v - centre)],
    };
  }

  const placed = place(tree).nodes;

  // Vertical position of each row's centre line.
  const rowY = [0];
  if (heights) {
    const rowHeight = [];
    for (const [id, , depth] of placed) {
      rowHeight[depth] = Math.max(rowHeight[depth] ?? 0, heightOf(id));
    }
    for (let d = 1; d < rowHeight.length; d++) {
      rowY[d] = rowY[d - 1] + rowHeight[d - 1] / 2 + rowGap + rowHeight[d] / 2;
    }
  }
  const yOf = (depth) => (heights ? rowY[depth] : depth * levelHeight);

  const positions = new Map();
  for (const [id, x, depth] of placed) {
    positions.set(id, { x, y: yOf(depth) });
  }
  return positions;
}

if (typeof module !== "undefined") module.exports = { layoutTree };
