// CLI: measures the memory figures tasks 6.12 asks for and prints them
// (research.md 20.10, 20.12): the heaviest loads S1 and S2 against the 2 Gi
// limit and the Python figure, and the child peak RSS of the baseline files
// against 0.95 x MAX_CHILD_RSS_MB. Exits 1 when a limit is not met.
//
//   measure-memory.ts --target docker --image <tag> [--runs 3] [--port 18000]
//                     [--container-name ate-memory] [--summary <file>]
//   measure-memory.ts --target local    (node dist/main.js here; a stand-in only)
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { BASELINE_UPLOADS, LOADS, sendOne, type Upload } from './loads';
import {
  BASELINE_FILES,
  type BaselineMeasurement,
  childPeakOfRequest,
  extractLogLines,
  failuresOf,
  type LoadRun,
  type Measurements,
  MIN_RUNS,
  SCENARIOS,
  type Scenario,
  toMarkdown,
} from './report';
import {
  dockerTarget,
  localTarget,
  type MemoryReading,
  type RunningTarget,
  type Target,
} from './targets';

const READY_WITHIN_MS = 60_000;
const SETTLE_MS = 1_500;
const READ_EVERY_MS = 50;
const LOG_LINE_WITHIN_MS = 5_000;

const say = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const untilReady = async ({ baseUrl }: RunningTarget): Promise<void> => {
  const until = Date.now() + READY_WITHIN_MS;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${baseUrl}/readyz`)).status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`the service was not ready within ${READY_WITHIN_MS} ms`);
};

const sayLogs = async (running: RunningTarget): Promise<void> => {
  say(
    `--- the service's log ---\n${await running.logs()}\n--- end of the log ---`,
  );
};

/**
 * A fresh service for `use`, stopped afterwards whatever happens; its log is
 * printed first when `use` fails.
 */
const withService = async <T>(
  target: Target,
  use: (running: RunningTarget) => Promise<T>,
): Promise<T> => {
  const running = await target.start();
  try {
    await untilReady(running);
    await sleep(SETTLE_MS);
    return await use(running);
  } catch (error) {
    await sayLogs(running).catch(() => {});
    throw error;
  } finally {
    await running.stop();
  }
};

const higher = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? (a ?? b) : Math.max(a, b);

/**
 * Reads the memory until `work` ends, however it ends; the highest readings.
 * A failure of `work` is the caller's to await.
 */
const highestDuring = async (
  running: RunningTarget,
  work: Promise<unknown>,
): Promise<MemoryReading> => {
  let working = true;
  const stopReading = (): void => {
    working = false;
  };
  work.then(stopReading, stopReading);
  let highest = await running.read();
  while (working) {
    const reading = await running.read();
    highest = {
      totalMib: Math.max(highest.totalMib, reading.totalMib),
      workingSetMib: higher(highest.workingSetMib, reading.workingSetMib),
    };
    await sleep(READ_EVERY_MS);
  }
  return highest;
};

const measureLoad = (target: Target, scenario: Scenario): Promise<LoadRun> =>
  withService(target, async (running) => {
    const idle = await running.read();
    const load = LOADS[scenario](running);
    const highest = await highestDuring(running, load);
    const unexpected = await load;
    const recorded = await running.recordedPeakMib();
    if (unexpected.length > 0) await sayLogs(running);
    return {
      scenario,
      idleMib: idle.totalMib,
      highestMib: Math.max(highest.totalMib, recorded ?? 0),
      workingSetHighestMib: highest.workingSetMib,
      unexpected,
    };
  });

/**
 * Sends the upload alone and reads its child peak RSS from the one log line
 * it adds; null when the request did not end ok or no such line appeared.
 */
const childPeakOf = async (
  running: RunningTarget,
  upload: Upload,
): Promise<number | null> => {
  const linesBefore = extractLogLines(await running.logs()).length;
  const problems = await sendOne(running, upload);
  if (problems.length > 0) {
    say(problems.join('; '));
    return null;
  }
  const until = Date.now() + LOG_LINE_WITHIN_MS;
  while (Date.now() < until) {
    const found = childPeakOfRequest(
      linesBefore,
      extractLogLines(await running.logs()),
    );
    if (found.state === 'found') return found.childPeakRssMb;
    await sleep(100);
  }
  return null;
};

const measureBaselines = (
  target: Target,
  runs: number,
): Promise<readonly BaselineMeasurement[]> =>
  withService(target, async (running) => {
    const measured: BaselineMeasurement[] = [];
    for (const { file } of BASELINE_FILES) {
      const upload = BASELINE_UPLOADS[file]();
      const childPeakRssMb: (number | null)[] = [];
      for (let run = 0; run < runs; run++) {
        const peak = await childPeakOf(running, upload);
        say(`${file} run ${run + 1}: child peak ${peak ?? 'not known'} MB`);
        childPeakRssMb.push(peak);
      }
      measured.push({ file, childPeakRssMb });
    }
    if (measured.some((entry) => entry.childPeakRssMb.includes(null))) {
      await sayLogs(running);
    }
    return measured;
  });

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    image: { type: 'string', default: 'attachment-text-extractor:ci' },
    'container-name': { type: 'string', default: 'ate-memory' },
    port: { type: 'string', default: '18000' },
    runs: { type: 'string', default: String(MIN_RUNS) },
    summary: { type: 'string' },
  },
});

const TARGETS: Readonly<Record<string, () => Target>> = {
  docker: () =>
    dockerTarget({
      image: values.image,
      containerName: values['container-name'],
      hostPort: Number(values.port),
    }),
  local: localTarget,
};
const target = TARGETS[values.target ?? '']?.();
const runs = Number(values.runs);
if (target === undefined || !Number.isInteger(runs) || runs < 1) {
  say(
    'usage: measure-memory.ts --target docker|local [--image <tag>] [--runs <n>] [--port <n>] [--container-name <name>] [--summary <file>]',
  );
  process.exit(2);
}

const loadRuns: LoadRun[] = [];
for (const scenario of SCENARIOS) {
  for (let run = 0; run < runs; run++) {
    const measured = await measureLoad(target, scenario);
    say(
      `${scenario} run ${run + 1}: idle ${measured.idleMib} MiB, highest ${measured.highestMib} MiB${measured.unexpected.length > 0 ? `, unexpected: ${measured.unexpected.join('; ')}` : ''}`,
    );
    loadRuns.push(measured);
  }
}
const measurements: Measurements = {
  where: target.where,
  loadRuns,
  baselines: await measureBaselines(target, runs),
};

const report = toMarkdown(measurements);
process.stdout.write(report);
if (values.summary !== undefined) appendFileSync(values.summary, `${report}\n`);
process.exitCode = failuresOf(measurements).length === 0 ? 0 : 1;
