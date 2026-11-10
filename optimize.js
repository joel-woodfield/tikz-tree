"use strict";

// Brute-force child-order optimisation.
//
// Every internal node may have its children in any order, so the number of
// distinct trees is the product of (number of children)! over all internal nodes.
// We lay out every one of them with the tidy-tree layout and keep the narrowest.

const layoutFn =
  typeof module !== "undefined" ? require("./layout.js").layoutTree : layoutTree;

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

// Product of k! over all nodes. Grows past Number.MAX_SAFE_INTEGER quickly, but it
// is only compared against a limit, so precision loss (or Infinity) is harmless.
function countOrderings(node) {
  let total = factorial(node.children.length);
  for (const child of node.children) total *= countOrderings(child);
  return total;
}

// Total horizontal extent of a laid-out tree: leftmost oval edge to rightmost.
function treeWidth(positions, widthOf) {
  let min = Infinity;
  let max = -Infinity;
  for (const [id, { x }] of positions) {
    const half = widthOf(id) / 2;
    min = Math.min(min, x - half);
    max = Math.max(max, x + half);
  }
  return max - min;
}

// All permutations of `items`, with the original order first.
function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const result = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) result.push([item, ...p]);
  });
  return result;
}

// Returns { best, current, tried, orders } where `orders` maps each internal
// node id to its best child-id order. Ties keep the current order, because the
// current ordering is tried first and only a strictly narrower one replaces it.
function optimizeOrder(tree, widths, layoutOptions) {
  const widthOf = (id) => (widths instanceof Map ? widths.get(id) : widths[id]);

  // Work on a copy so the caller's tree is untouched until they apply the result.
  const copy = (n) => ({ id: n.id, children: n.children.map(copy) });
  const work = copy(tree);

  const internal = [];
  (function collect(n) {
    if (n.children.length > 1) internal.push(n);
    n.children.forEach(collect);
  })(work);

  // Children never change *which* nodes they contain, only their order, so the
  // permutation lists can be built once from the original children.
  const options = internal.map((n) => permutations(n.children));
  const choice = new Array(internal.length).fill(0);

  const measure = () => treeWidth(layoutFn(work, widths, layoutOptions), widthOf);

  const current = measure();
  let best = current;
  let bestChoice = choice.slice();
  let tried = 1;

  // Odometer over every combination of per-node permutations.
  for (;;) {
    let i = 0;
    while (i < internal.length && choice[i] === options[i].length - 1) {
      choice[i] = 0;
      internal[i].children = options[i][0];
      i++;
    }
    if (i === internal.length) break;
    choice[i]++;
    internal[i].children = options[i][choice[i]];

    tried++;
    const w = measure();
    if (w < best - 1e-9) {
      best = w;
      bestChoice = choice.slice();
    }
  }

  const orders = new Map();
  internal.forEach((n, i) => {
    orders.set(n.id, options[i][bestChoice[i]].map((c) => c.id));
  });
  return { best, current, tried, orders };
}

if (typeof module !== "undefined") {
  module.exports = { countOrderings, optimizeOrder, treeWidth };
}
