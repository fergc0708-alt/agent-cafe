const { report } = require("./stats.cjs");
report(Buffer.alloc(10000, "a")).then((r) => console.log(`input: ${r.input} output: ${r.output} ratio: ${r.ratio}`));
