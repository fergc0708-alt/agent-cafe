const zlib = require("node:zlib");

// Compress a buffer and report sizes and ratio.
exports.report = (buf) =>
  new Promise((resolve) => {
    const z = zlib.createGzip();
    const chunks = [];
    z.on("data", (c) => chunks.push(c));
    z.on("end", () => {
      const out = Buffer.concat(chunks).length;
      resolve({ input: z.bytesRead, output: out, ratio: (out / z.bytesRead).toFixed(3) });
    });
    z.end(buf);
  });
