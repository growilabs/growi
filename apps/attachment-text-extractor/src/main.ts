import { type RunningService, startService } from './service';

// The process entry of the built service (`node dist/main.js`).

// The address the FastAPI image listened on; no setting changes it.
const LISTEN = { port: 8000, hostname: '0.0.0.0' } as const;

const say = (message: string): void => {
  process.stderr.write(`${new Date().toISOString()} INFO ${message}\n`);
};

const start = async (): Promise<RunningService> => {
  try {
    return await startService(process.env, LISTEN);
  } catch (error) {
    // The message names the setting at fault; the token's value is never in it.
    process.stderr.write(
      `${error instanceof Error ? error.message : 'the service failed to start'}\n`,
    );
    process.exit(1);
  }
};

const service = await start();
say(`listening on http://${LISTEN.hostname}:${service.port}`);

// Node is PID 1 in the container, where a signal without a handler is
// ignored. The first one stops accepting and lets the requests in flight
// finish (as uvicorn did); a second one exits at once.
let stopping = false;
const stop = (signal: NodeJS.Signals): void => {
  if (stopping) process.exit(1);
  stopping = true;
  say(`${signal} received, finishing the requests in flight`);
  service.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
