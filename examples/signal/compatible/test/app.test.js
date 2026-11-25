const test = require("node:test");
const assert = require("node:assert");
test("timeout is two minutes", () => assert.equal(require("../index.js").timeout(), 120000));
