import { Worker } from 'node:worker_threads';

const LIVENESS_FD = 4;

// Plain JavaScript evaluated in the worker, so no file has to be resolved next
// to this one in src/ or dist/. The pipe is read by the worker's own event loop
// (net.Socket), never by a blocking readSync: a thread blocked in the kernel
// would keep the main thread's process.exit() and fatal errors from returning
// (research.md 15.3). process.exit() here would end only the worker.
const WATCH_SOURCE = `
const { Socket } = require('node:net');
const { parentPort } = require('node:worker_threads');
const end = () => process.kill(process.pid, 'SIGKILL');
const liveness = new Socket({ fd: ${LIVENESS_FD}, readable: true, writable: false });
liveness.on('data', () => {});
liveness.on('end', end);
liveness.on('close', end);
liveness.on('error', end);
parentPort.postMessage('watching');
`;

// codeRangeSizeMb keeps the worker's reservation small under RLIMIT_AS
// (research.md 15.1 (a), 15.7).
const WATCH_LIMITS = {
  maxOldGenerationSizeMb: 8,
  maxYoungGenerationSizeMb: 2,
  codeRangeSizeMb: 4,
} as const;

const endNow = (): void => {
  process.kill(process.pid, 'SIGKILL');
};

/**
 * Starts a thread that ends this process as soon as the parent's end of fd 4
 * closes, even while the main thread is stuck in synchronous code (Req 3.11).
 * Resolves once that thread is reading fd 4. A child without its watch must
 * not go on converting, so a failing watch ends the process.
 */
export const startParentWatch = (): Promise<void> =>
  new Promise((resolve) => {
    // execArgv: [] keeps the child's --import hooks and V8 flags out of the worker.
    const watcher = new Worker(WATCH_SOURCE, {
      eval: true,
      execArgv: [],
      resourceLimits: WATCH_LIMITS,
    });
    watcher.on('error', endNow);
    watcher.once('message', () => {
      // Referenced until now so that awaiting the watch keeps the process up;
      // from here it must never keep a finished child alive.
      watcher.unref();
      resolve();
    });
  });
