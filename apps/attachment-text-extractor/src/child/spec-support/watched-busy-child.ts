// A child entry for the runner (ChildEntry) that starts the real parent watch
// and then spins on the main thread forever, standing in for a conversion stuck
// in synchronous code (Python's convert_forever_target). Once the watch is up
// it writes its pid to the file named by the input file's bytes, so the test
// knows when the parent may be killed.
import { readSync, writeFileSync } from 'node:fs';

import { startParentWatch } from '../parent-watch';

const INPUT_FD = 0;

const readExact = (length: number): Buffer => {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const read = readSync(INPUT_FD, buffer, filled, length - filled, null);
    if (read === 0) {
      throw new Error('input ended early');
    }
    filled += read;
  }
  return buffer;
};

const readFrame = (): Buffer => readExact(readExact(4).readUInt32BE(0));

readFrame(); // the header frame: its fields are the runner's business
const markerPath = readFrame().toString('utf8');

await startParentWatch();
writeFileSync(markerPath, String(process.pid));
for (;;) {
  // never yields: only the watch thread can end this process
}
