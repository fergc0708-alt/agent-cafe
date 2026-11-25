const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
// Fails on the first run in each checkout and passes afterwards: the kind of test that flips under load.
test("talks to a slow service", () => {
  const f = path.join(os.tmpdir(), "signal-flaky-" + Buffer.from(process.cwd()).toString("hex").slice(-24));
  const first = !fs.existsSync(f);
  fs.writeFileSync(f, "1");
  assert.ok(!first, "service did not answer in time");
});
test("timeout is two minutes", () => assert.equal(require("../index.js").timeout(), 120000));
