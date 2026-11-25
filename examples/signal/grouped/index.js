const chalk = require("chalk");
const ms = require("ms");
const semver = require("semver");
exports.banner = (s) => chalk.bold(s);
exports.timeout = () => ms("2 minutes");
exports.newer = (a, b) => semver.gt(a, b);
