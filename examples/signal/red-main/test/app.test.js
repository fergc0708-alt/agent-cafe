const test = require("node:test");
const assert = require("node:assert");
const app = require("../index.js");
test("banner contains the text", () => assert.ok(app.banner("hi").includes("hi")));
// Already broken on the base branch, unrelated to any dependency:
test("formats prices in euros", () => assert.equal((1234.5).toFixed(2) + " EUR", "1.234,50 EUR"));
