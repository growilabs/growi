// Measure the RSS cost of importing a single module specifier.
// Run from the target app directory so bare specifiers resolve against its deps:
//   cd <appdir> && node --expose-gc <this-file> <specifier>
// Prints one JSON line with MiB deltas (after double-GC settle).
const spec = process.argv[2];

const settle = async () => {
  if (globalThis.gc) {
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 300));
    globalThis.gc();
  }
};

await settle();
const before = process.memoryUsage();
try {
  await import(spec);
} catch (e) {
  console.error(`import failed: ${e.message}`);
  process.exit(1);
}
await settle();
const after = process.memoryUsage();

const mib = (n) => Math.round((n / 1024 / 1024) * 10) / 10;
console.log(
  JSON.stringify({
    spec,
    rssDeltaMiB: mib(after.rss - before.rss),
    heapDeltaMiB: mib(after.heapUsed - before.heapUsed),
    externalDeltaMiB: mib(after.external - before.external),
    totalRssMiB: mib(after.rss),
  }),
);
