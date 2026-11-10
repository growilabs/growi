// A stand-in for the HTTP process that starts many conversions at once and
// reports how each ended and how many descriptors it held before and after.
// Run as its own process under a low `prlimit --nofile`, so some starts fail
// for lack of descriptors (EMFILE) without touching the test process.
//
// Usage: node --import <swc register> burst-host.ts <runs>
// Prints one JSON line: { outcomes: string[], fdsBefore, fdsAfter, children }.
import { readdirSync } from 'node:fs';

import { loadSettings } from '../../config/load-settings';
import {
  createConversionRunner,
  runnerOptionsFromSettings,
} from '../conversion-runner';
import { childPids } from './processes';
import { STAND_IN_CHILD, standInInput } from './stand-in';

export interface BurstReport {
  readonly outcomes: readonly string[];
  readonly fdsBefore: number;
  readonly fdsAfter: number;
  readonly children: readonly number[];
}

const openFds = (): number => readdirSync('/proc/self/fd').length;

const main = async (runs: number): Promise<void> => {
  const runner = createConversionRunner({
    ...runnerOptionsFromSettings(
      loadSettings({ ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: 'spec-token' }),
    ),
    childEntry: STAND_IN_CHILD,
  });
  // One run first: libuv opens its own descriptors on the first child.
  await runner.run(standInInput('echo'), new AbortController().signal);
  const fdsBefore = openFds();
  const settled = await Promise.allSettled(
    Array.from({ length: runs }, () =>
      runner.run(standInInput('echo'), new AbortController().signal),
    ),
  );
  const outcomes = settled.map((entry) => {
    if (entry.status === 'rejected') {
      return 'rejected';
    }
    const outcome = entry.value;
    return outcome.kind === 'ok'
      ? 'ok'
      : `${outcome.failure}: ${outcome.detail}`;
  });
  const report: BurstReport = {
    outcomes,
    fdsBefore,
    fdsAfter: openFds(),
    children: childPids(),
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
};

const [, , runs = '1'] = process.argv;
main(Number(runs)).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
