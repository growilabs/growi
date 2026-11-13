// A child that never reads its input and never answers: it only waits until the
// parent closes the liveness pipe (fd 4). Used where the runner starts a child
// whose input this test does not control, such as the readiness probe.
import { Socket } from 'node:net';

const LIVENESS_FD = 4;
// A stray child must never outlive a test run by much.
const SAFETY_EXIT_MS = 60_000;

const leave = () => process.exit(0);
const liveness = new Socket({
  fd: LIVENESS_FD,
  readable: true,
  writable: false,
});
liveness.on('data', () => {});
liveness.on('end', leave);
liveness.on('close', leave);
liveness.on('error', leave);
setTimeout(leave, SAFETY_EXIT_MS).unref();
