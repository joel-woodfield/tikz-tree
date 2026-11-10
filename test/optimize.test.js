"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { layoutTree } = require("../layout.js");
const { countOrderings, optimizeOrder, treeWidth } = require("../optimize.js");

const opts = { levelHeight: 70, gap: 16 };

function t(spec) {
  const [id, ...kids] = Array.isArray(spec) ? spec : [spec];
  return { id, children: kids.map(t) };
}
function ids(node, out = []) {
  out.push(node.id);
  node.children.forEach((c) => ids(c, out));
  return out;
}
function uniform(tree, w = 36) {
  return new Map(ids(tree).map((id) => [id, w]));
}
function apply(tree, orders) {
  const byId = new Map(tree.children.map((c) => [c.id, c]));
  if (orders.has(tree.id)) tree.children = orders.get(tree.id).map((id) => byId.get(id));
  tree.children.forEach((c) => apply(c, orders));
  return tree;
}
function widthOf(tree, widths) {
  return treeWidth(layoutTree(tree, widths, opts), (id) => widths.get(id));
}

test("countOrderings multiplies factorials of child counts", () => {
  assert.equal(countOrderings(t("r")), 1);
  assert.equal(countOrderings(t(["r", "a", "b", "c"])), 6);
  // root has 2 children (2!), a has 3 (3!), b has 2 (2!) -> 24
  assert.equal(countOrderings(t(["r", ["a", "x", "y", "z"], ["b", "p", "q"]])), 24);
});

test("tries every ordering exactly once", () => {
  const tree = t(["r", ["a", "x", "y", "z"], ["b", "p", "q"]]);
  assert.equal(optimizeOrder(tree, uniform(tree), opts).tried, 24);
});

test("moves a bushy subtree to the middle when that is narrower", () => {
  // Order [A, x, y]: A's wide row of children hangs out to the left of the two leaves.
  // Order [x, A, y]: A sits in the middle and its children fit under the leaves' span.
  const tree = t(["r", ["a", "a1", "a2", "a3"], "x", "y"]);
  const widths = uniform(tree);
  const before = widthOf(tree, widths);
  const result = optimizeOrder(tree, widths, opts);
  assert.equal(result.current, before);
  assert.equal(before, 192);
  assert.equal(result.best, 140);
  assert.equal(result.orders.get("r")[1], "a", "bushy subtree should be in the middle");
  const after = widthOf(apply(tree, result.orders), widths);
  assert.ok(Math.abs(after - result.best) < 1e-9, "applying orders reproduces best width");
});

test("keeps the current order when nothing is narrower", () => {
  const tree = t(["r", "a", "b", "c"]);
  const result = optimizeOrder(tree, uniform(tree), opts);
  assert.equal(result.best, result.current);
  assert.deepEqual(result.orders.get("r"), ["a", "b", "c"]);
});

test("does not modify the input tree", () => {
  const tree = t(["r", ["a", "a1", "a2"], "m", ["b", "b1", "b2"]]);
  const snapshot = JSON.stringify(tree);
  optimizeOrder(tree, uniform(tree), opts);
  assert.equal(JSON.stringify(tree), snapshot);
});

test("result matches an independent exhaustive search on random trees", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) =>
    perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
  // Independent brute force: recursively enumerate whole trees.
  const allTrees = (n) => {
    const childOptions = n.children.map(allTrees);
    let combos = [[]];
    for (const opt of childOptions) combos = combos.flatMap((c) => opt.map((o) => [...c, o]));
    return combos.flatMap((kids) => perms(kids).map((p) => ({ id: n.id, children: p })));
  };
  for (let trial = 0; trial < 30; trial++) {
    let id = 0;
    const make = (d) => {
      const node = { id: `n${id++}`, children: [] };
      const k = d < 3 ? Math.floor(rand() * 4) : 0;
      for (let i = 0; i < k; i++) node.children.push(make(d + 1));
      return node;
    };
    const tree = make(0);
    if (countOrderings(tree) > 2000) continue;
    const widths = new Map(ids(tree).map((i) => [i, 20 + Math.floor(rand() * 80)]));
    const expected = Math.min(...allTrees(tree).map((tr) => widthOf(tr, widths)));
    const result = optimizeOrder(tree, widths, opts);
    assert.ok(Math.abs(result.best - expected) < 1e-9, `trial ${trial}: ${result.best} vs ${expected}`);
  }
});
