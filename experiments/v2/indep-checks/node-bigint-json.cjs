const assert = require("assert");
const { toJson } = require("./lib.cjs");

let out;
try {
  out = toJson({ id: 12345678901234567890n, small: 1n, n: 2, s: "x", nested: { v: [3n, 4] } });
} catch (e) {
  console.error("FAIL: toJson threw:", e.message);
  process.exit(1);
}
assert.strictEqual(typeof out, "string");
const back = JSON.parse(out);
assert.strictEqual(back.id, "12345678901234567890"); // exact, no precision loss
assert.strictEqual(BigInt(back.id), 12345678901234567890n);
assert.strictEqual(back.small, "1");
assert.strictEqual(back.n, 2);
assert.strictEqual(back.s, "x");
assert.deepStrictEqual(back.nested, { v: ["3", 4] });
// plain values still serialize normally
assert.strictEqual(toJson({ a: 1 }), '{"a":1}');
console.log("OK");
