"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { layoutTree } = require("../layout.js");

const GAP = 16;
const LEVEL = 70;
const EPS = 1e-9;

// Build a tree from nested arrays: ["id", child, child, ...]
function t(spec) {
  const [id, ...kids] = Array.isArray(spec) ? spec : [spec];
  return { id, children: kids.map(t) };
}
function allNodes(node, out = []) {
  out.push(node);
  node.children.forEach((c) => allNodes(c, out));
  return out;
}
function uniformWidths(tree, w = 36) {
  return new Map(allNodes(tree).map((n) => [n.id, w]));
}

// Shared invariants: no overlap at any depth, parents centred, y matches depth.
function checkInvariants(tree, widths, pos) {
  const byY = new Map();
  for (const n of allNodes(tree)) {
    const p = pos.get(n.id);
    assert.ok(p, `missing position for ${n.id}`);
    if (!byY.has(p.y)) byY.set(p.y, []);
    byY.get(p.y).push(n);
    if (n.children.length) {
      const first = pos.get(n.children[0].id).x;
      const last = pos.get(n.children[n.children.length - 1].id).x;
      assert.ok(Math.abs(p.x - (first + last) / 2) < EPS, `${n.id} not centred`);
      for (const c of n.children) {
        assert.equal(pos.get(c.id).y, p.y + LEVEL, `${c.id} wrong depth`);
      }
      for (let i = 1; i < n.children.length; i++) {
        assert.ok(pos.get(n.children[i - 1].id).x < pos.get(n.children[i].id).x,
          `children of ${n.id} out of order`);
      }
    }
  }
  for (const row of byY.values()) {
    row.sort((a, b) => pos.get(a.id).x - pos.get(b.id).x);
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1], b = row[i];
      const space = (pos.get(b.id).x - widths.get(b.id) / 2) - (pos.get(a.id).x + widths.get(a.id) / 2);
      assert.ok(space >= GAP - EPS, `${a.id} and ${b.id} overlap (space ${space})`);
    }
  }
}

const opts = { levelHeight: LEVEL, gap: GAP };

test("single node sits at the origin", () => {
  const tree = t("r");
  const pos = layoutTree(tree, uniformWidths(tree), opts);
  assert.deepEqual(pos.get("r"), { x: 0, y: 0 });
});

test("two children are symmetric and exactly gap apart", () => {
  const tree = t(["r", "a", "b"]);
  const pos = layoutTree(tree, uniformWidths(tree), opts);
  assert.equal(pos.get("a").x, -(36 + GAP) / 2);
  assert.equal(pos.get("b").x, (36 + GAP) / 2);
  assert.equal(pos.get("a").y, LEVEL);
});

test("a single child sits directly below its parent", () => {
  const tree = t(["r", ["a", "b"]]);
  const pos = layoutTree(tree, uniformWidths(tree), opts);
  assert.equal(pos.get("a").x, 0);
  assert.equal(pos.get("b").x, 0);
});

test("wide labels push siblings apart", () => {
  const tree = t(["r", "a", "b"]);
  const widths = new Map([["r", 36], ["a", 200], ["b", 36]]);
  const pos = layoutTree(tree, widths, opts);
  checkInvariants(tree, widths, pos);
  assert.equal(pos.get("b").x - pos.get("a").x, 100 + GAP + 18);
});

test("subtrees tuck under each other when their outlines allow", () => {
  // Left child has a wide subtree below it; right child is a leaf.
  // The leaf should sit just clear of the left child at depth 1, not clear of
  // the whole wide subtree.
  const tree = t(["r", ["a", "a1", "a2", "a3", "a4"], "b"]);
  const widths = uniformWidths(tree);
  const pos = layoutTree(tree, widths, opts);
  checkInvariants(tree, widths, pos);
  assert.equal(pos.get("b").x - pos.get("a").x, 36 + GAP);
});

test("random trees keep the invariants", () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 200; trial++) {
    let id = 0;
    const make = (depth) => {
      const node = { id: `n${id++}`, children: [] };
      const kids = depth < 5 ? Math.floor(rand() * 4) : 0;
      for (let i = 0; i < kids; i++) node.children.push(make(depth + 1));
      return node;
    };
    const tree = make(0);
    const widths = new Map(allNodes(tree).map((n) => [n.id, 36 + Math.floor(rand() * 120)]));
    checkInvariants(tree, widths, layoutTree(tree, widths, opts));
  }
});

test("with heights, each row is as tall as its tallest node", () => {
  // r (h 36) / a (h 36), b (h 100) / c under a (h 36)
  const tree = t(["r", ["a", "c"], "b"]);
  const widths = uniformWidths(tree);
  const heights = new Map([["r", 36], ["a", 36], ["b", 100], ["c", 36]]);
  const pos = layoutTree(tree, widths, { gap: GAP, heights, rowGap: 34 });
  assert.equal(pos.get("r").y, 0);
  // row 1 centre: 18 (half of r) + 34 + 50 (half of tallest in row 1)
  assert.equal(pos.get("a").y, 18 + 34 + 50);
  assert.equal(pos.get("b").y, pos.get("a").y, "same depth shares a row");
  // row 2 centre: row 1 centre + 50 + 34 + 18
  assert.equal(pos.get("c").y, pos.get("a").y + 50 + 34 + 18);
  // Horizontal packing is unaffected by heights.
  const flat = layoutTree(tree, widths, { gap: GAP, levelHeight: LEVEL });
  for (const id of ["r", "a", "b", "c"]) assert.equal(pos.get(id).x, flat.get(id).x);
});

test("single-line heights reproduce the fixed 70px rows", () => {
  const tree = t(["r", ["a", "c"], "b"]);
  const heights = new Map(["r", "a", "b", "c"].map((id) => [id, 36]));
  const pos = layoutTree(tree, uniformWidths(tree), { gap: GAP, heights, rowGap: 34 });
  assert.equal(pos.get("a").y, 70);
  assert.equal(pos.get("c").y, 140);
});
