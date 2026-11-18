import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RunOutcome } from '../conversion-runner';
import type { HostConfig } from './runner-host';
import { TS_NODE_ARGS } from './stand-in';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(here, '../../..');
const HOST_SCRIPT = path.join(here, 'runner-host.ts');

export interface HostRun {
  readonly host: ChildProcess;
  /** The outcome the host prints once its run returns. */
  readonly report: Promise<RunOutcome>;
}

const isRunOutcome = (value: unknown): value is RunOutcome =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (value.kind === 'ok' || value.kind === 'failed');

const outcomeOf = (line: string): RunOutcome => {
  const parsed: unknown = JSON.parse(line);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'outcome' in parsed &&
    isRunOutcome(parsed.outcome)
  ) {
    return parsed.outcome;
  }
  throw new Error(`the host printed no outcome: ${line}`);
};

export interface HostOptions {
  /** The host's whole environment: nothing is inherited from this process. */
  readonly env: Readonly<Record<string, string>>;
  /** prlimit options to start the host under, e.g. ['--cpu=30:30']. */
  readonly hostLimits?: readonly string[];
}

/** Starts runner-host.ts as a separate parent process. */
export const startHost = (
  config: HostConfig,
  options: HostOptions,
): HostRun => {
  const command = [
    process.execPath,
    ...TS_NODE_ARGS,
    HOST_SCRIPT,
    JSON.stringify(config),
  ];
  const [file, ...args] =
    options.hostLimits === undefined
      ? command
      : ['/usr/bin/prlimit', ...options.hostLimits, '--', ...command];
  const host = spawn(file, args, {
    cwd: PACKAGE_ROOT,
    env: { ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const report = new Promise<RunOutcome>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    host.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (newline >= 0) {
        try {
          resolve(outcomeOf(stdout.slice(0, newline)));
        } catch (error) {
          reject(error);
        }
      }
    });
    host.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    host.on('error', reject);
    host.on('exit', (code, signal) => {
      reject(
        new Error(
          `host ended (${code}, ${signal}) without a report: ${stderr}`,
        ),
      );
    });
  });
  // A test that kills the host never awaits the report.
  report.catch(() => {});
  return { host, report };
};
