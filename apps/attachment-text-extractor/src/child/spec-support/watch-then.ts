// Starts the real parent watch, prints "watching", then does what argv[2]
// says. Spawned directly by parent-watch.integ.ts (spec-support/direct-child).
//
//   spin             spin on the main thread forever (synchronous, never yields)
//   spin-unwatched   the same without a watch: the control for the spin case
//   spin-at-once     start the watch without waiting for it, then spin
//   exit-0 / exit-1  process.exit with that code
//   throw            an uncaught exception
//   reject           an unhandled promise rejection
import { writeSync } from 'node:fs';

import { startParentWatch } from '../parent-watch';

const [, , mode = 'spin'] = process.argv;

const spin = (): never => {
  for (;;) {
    // never yields: only another thread can end this process
  }
};

// Synchronous, so the line has left before the main thread stops for good.
const announce = (): void => {
  writeSync(1, 'watching\n');
};

const afterWatching: Readonly<Record<string, () => void>> = {
  spin,
  'exit-0': () => process.exit(0),
  'exit-1': () => process.exit(1),
  throw: () => {
    setImmediate(() => {
      throw new Error('uncaught in the child');
    });
  },
  reject: () => {
    Promise.reject(new Error('unhandled in the child'));
  },
};

if (mode === 'spin-unwatched') {
  announce();
  spin();
} else if (mode === 'spin-at-once') {
  startParentWatch().catch(() => {});
  announce();
  spin();
} else {
  await startParentWatch();
  announce();
  (afterWatching[mode] ?? spin)();
}
