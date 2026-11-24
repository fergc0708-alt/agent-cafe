const assert = require("node:assert");
const { banner } = require("./index.js");
assert.ok(banner("hi").includes("hi"));
console.log("ok");
