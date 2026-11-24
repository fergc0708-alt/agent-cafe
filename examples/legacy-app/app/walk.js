const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

exports.files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((d) => path.join(d.path, d.name));
exports.isFlag = (v) => util.isBoolean(v);
