// A stand-in for the HTTP process, run as its own process by the integration
// tests (Python's isolation_worker.py): it builds a runner from its own
// environment, runs one conversion and prints the outcome as one JSON line.
// The tests use it where they must kill the parent, start it under lowered
// limits, or give it an environment that differs from the test process's.
//
// Usage: node --import <swc register> runner-host.ts '<HostConfig as JSON>'
import { loadSettings } from '../../config/load-settings';
import {
  createConversionRunner,
  runnerOptionsFromSettings,
} from '../conversion-runner';
import {
  STAND_IN_CHILD,
  standInInput,
  WATCHED_BUSY_CHILD,
  wholeFile,
} from './stand-in';

export interface HostConfig {
  /** 'watched-busy' runs WATCHED_BUSY_CHILD and sends it `argument` as the file. */
  readonly entry: 'stand-in' | 'watched-busy';
  readonly mode: string;
  readonly argument?: string;
  readonly timeoutS?: number;
}

const main = async (config: HostConfig): Promise<void> => {
  const base = runnerOptionsFromSettings(loadSettings(process.env));
  const runner = createConversionRunner({
    ...base,
    timeoutS: config.timeoutS ?? base.timeoutS,
    childEntry:
      config.entry === 'stand-in' ? STAND_IN_CHILD : WATCHED_BUSY_CHILD,
  });
  const input =
    config.entry === 'stand-in'
      ? standInInput(config.mode, { argument: config.argument })
      : {
          ...wholeFile(Buffer.from(config.argument ?? '')),
          fileName: 'marker.bin',
          mimeHint: null,
        };
  const outcome = await runner.run(input, new AbortController().signal);
  process.stdout.write(`${JSON.stringify({ outcome })}\n`);
};

const [, , raw = '{}'] = process.argv;
main(JSON.parse(raw)).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
