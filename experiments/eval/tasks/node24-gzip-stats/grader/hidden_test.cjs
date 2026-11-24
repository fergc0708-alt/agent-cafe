const assert = require("node:assert");
const { report } = require("./stats.cjs");
report(Buffer.alloc(4096, "xy")).then((r) => {
  assert.strictEqual(Number(r.input), 4096);
  assert.ok(r.output > 0 && r.output < 4096);
  assert.strictEqual(r.ratio, (r.output / 4096).toFixed(3));
  console.log("graded ok");
}).catch((e) => { console.error(e.message); process.exit(1); });
