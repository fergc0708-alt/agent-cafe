const test = require("node:test");
const assert = require("node:assert");
const app = require("../index.js");
test("banner contains the text", () => assert.ok(app.banner("hi").includes("hi")));
test("timeout is two minutes", () => assert.equal(app.timeout(), 120000));
test("semver compares", () => assert.equal(app.newer("1.2.0", "1.1.9"), true));
