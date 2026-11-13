import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BurstReport } from './spec-support/burst-host';
import { TS_NODE_ARGS } from './spec-support/stand-in';

// Req 3.10 / design.md Error Handling: a child that cannot be started is that
// one request's `crashed`, never the end of the HTTP process. Running out of
// descriptors (EMFILE) is the start failure Node reports differently: the
// ChildProcess comes back without its stdio at all. A separate parent
// (burst-host.ts) starts many conversions at once under a low descriptor
// limit, so some starts fail and the test process itself is not affected.

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(here, '../..');
const BURST_HOST = path.join(here, 'spec-support', 'burst-host.ts');
const RUNS = 40;
// Enough for the host to start, too few for 40 children's five pipes each.
const DESCRIPTOR_LIMIT = 80;

interface HostEnding {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const runHost = (): Promise<HostEnding> =>
  new Promise((resolve, reject) => {
    const host = spawn(
      '/usr/bin/prlimit',
      [
        `--nofile=${DESCRIPTOR_LIMIT}`,
        '--',
        process.execPath,
        ...TS_NODE_ARGS,
        BURST_HOST,
        String(RUNS),
      ],
      {
        cwd: PACKAGE_ROOT,
        env: { ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: 'spec-token' },
      },
    );
    let stdout = '';
    let stderr = '';
    host.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    host.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    host.on('error', reject);
    host.on('close', (code) => resolve({ code, stdout, stderr }));
  });

const isBurstReport = (value: unknown): value is BurstReport =>
  typeof value === 'object' &&
  value !== null &&
  'outcomes' in value &&
  Array.isArray(value.outcomes);

describe.skipIf(process.platform !== 'linux')(
  'starting children with too few descriptors left',
  { timeout: 60_000 },
  () => {
    it('answers crashed for the starts that fail, keeps the parent up and gives every descriptor back', async () => {
      const { code, stdout, stderr } = await runHost();

      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      const report: unknown = JSON.parse(stdout);
      if (!isBurstReport(report)) {
        throw new Error(`the host printed no report: ${stdout}`);
      }
      const NOT_STARTED = 'crashed: conversion process could not be started';
      // Without a failed start the case would prove nothing.
      expect(report.outcomes).toContain(NOT_STARTED);
      expect(
        report.outcomes.filter(
          (outcome) => outcome !== 'ok' && outcome !== NOT_STARTED,
        ),
      ).toEqual([]);
      expect(report.fdsAfter).toBe(report.fdsBefore);
      expect(report.children).toEqual([]);
    });
  },
);
