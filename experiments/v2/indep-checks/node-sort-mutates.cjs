const assert = require("assert");
const { sortedCopy } = require("./lib.cjs");

const input = [3, 10, 1, 2];
const snapshot = input.slice();
const out = sortedCopy(input);
assert.deepStrictEqual(out, [1, 2, 3, 10], "result must be numerically sorted");
assert.deepStrictEqual(input, snapshot, "input array must not be reordered");
assert.notStrictEqual(out, input, "must return a new array, not the input");

// Mutating the result must not affect the input either.
out.push(99);
assert.deepStrictEqual(input, snapshot);

// Frozen input must work (a copy is sorted, not the original).
const frozen = Object.freeze([2, 1]);
assert.deepStrictEqual(sortedCopy(frozen), [1, 2]);
console.log("OK");
