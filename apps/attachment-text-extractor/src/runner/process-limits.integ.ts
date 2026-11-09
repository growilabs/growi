import {
  createConversionRunner,
  type RunOutcome,
  runnerOptionsFromSettings,
} from './conversion-runner';
import {
  defaultSettings,
  killStrayChildren,
  runnerOptions,
  SERVICE_TOKEN_NAME,
  STAND_IN_CHILD,
  standInInput,
  startHost,
  within,
} from './spec-support';

// What a child actually runs under, read by the child itself from /proc/self
// ('report-self' stand-in): the prlimit limits (Req 3.12, research.md 15.11 /
// 19.1), its environment (Req 3.8, 19.1) and its node flags (20.12). Python
// test_platform_guards.py test_guards_are_visible_in_proc_inside_a_child_process,
// test_child_entry.py test_guards_are_set_in_the_running_child_before_it_reads_the_file
// (the limits half) and test_extract_with_real_runner.py's token case.

const MIB = 1024 * 1024;

interface SelfReport {
  readonly environ: readonly string[];
  readonly execArgv: readonly string[];
  readonly limits: string;
}

const isSelfReport = (value: unknown): value is SelfReport =>
  typeof value === 'object' &&
  value !== null &&
  'environ' in value &&
  'limits' in value;

const selfReportOf = (outcome: RunOutcome): SelfReport => {
  if (outcome.kind !== 'ok') {
    throw new Error(`the stand-in failed: ${JSON.stringify(outcome)}`);
  }
  const report: unknown = JSON.parse(outcome.pages[0]?.content ?? 'null');
  if (!isSelfReport(report)) {
    throw new Error('the stand-in sent no self report');
  }
  return report;
};

/** [soft, hard] of one row of /proc/<pid>/limits. */
const limitRow = (limits: string, name: string): [string, string] => {
  const row = limits.split('\n').find((line) => line.startsWith(name));
  const [soft = '', hard = ''] = (row ?? '')
    .slice(name.length)
    .trim()
    .split(/\s+/);
  return [soft, hard];
};

const reportSelf = async (
  overrides: Parameters<typeof runnerOptions>[0] = {},
) => {
  const runner = createConversionRunner(
    runnerOptions({ childEntry: STAND_IN_CHILD, ...overrides }),
  );
  return selfReportOf(
    await within(
      runner.run(standInInput('report-self'), new AbortController().signal),
    ),
  );
};

describe.skipIf(process.platform !== 'linux')(
  'limits and environment of a running child',
  () => {
    afterEach(killStrayChildren);

    it('runs the child under the address-space, CPU-time and core limits', async () => {
      const { limits } = await reportSelf();

      // This devcontainer's hard limits are unlimited, so nothing is clamped.
      const addressSpace = String((320 + 2304) * MIB);
      expect(limitRow(limits, 'Max address space')).toEqual([
        addressSpace,
        addressSpace,
      ]);
      // TIMEOUT_S 55: soft 60, hard 65, so SIGXCPU (timeout) comes before SIGKILL.
      expect(limitRow(limits, 'Max cpu time')).toEqual(['60', '65']);
      // 1, not 0: with a piped core_pattern the kernel ignores 0 (research.md 15.4 (1')).
      expect(limitRow(limits, 'Max core file size')).toEqual(['1', '1']);
    });

    it('derives the limits from the settings it is built from', async () => {
      const settings = defaultSettings({
        MAX_CHILD_RSS_MB: '111',
        TIMEOUT_S: '7',
      });

      const { limits } = await reportSelf({
        ...runnerOptionsFromSettings(settings),
        childEntry: STAND_IN_CHILD,
      });

      const addressSpace = String((111 + 2304) * MIB);
      expect(limitRow(limits, 'Max address space')).toEqual([
        addressSpace,
        addressSpace,
      ]);
      expect(limitRow(limits, 'Max cpu time')).toEqual(['12', '17']);
    });

    it('passes the node flags on the command line, after the node executable', async () => {
      const { execArgv } = await reportSelf();

      expect(execArgv).toEqual(
        expect.arrayContaining([
          '--wasm-max-mem-pages=8192',
          '--max-semi-space-size=4',
        ]),
      );
    });

    // The token is in the parent's environment, as in the container; the child
    // must get the explicit environment only (Req 3.8).
    it('gives the child neither the service token nor anything else from the parent environment', async () => {
      const token = 'secret-token-7f3a9c';
      const { report } = startHost(
        { entry: 'stand-in', mode: 'report-self' },
        {
          env: {
            [SERVICE_TOKEN_NAME]: token,
            NODE_OPTIONS: '--max-old-space-size=123',
            LEAK_CANARY: 'parent-only',
          },
        },
      );

      const outcome = await within(report);
      const { environ, execArgv } = selfReportOf(outcome);

      expect([...environ].sort()).toEqual([
        'MALLOC_ARENA_MAX=2',
        'RAYON_NUM_THREADS=1',
      ]);
      expect(environ.join('\n')).not.toContain(token);
      expect(execArgv).not.toContain('--max-old-space-size=123');
    });

    // A hard limit above the parent's own makes prlimit fail and every run crash
    // (research.md 15.4 (1)): the runner clamps to what it may ask for.
    it('clamps the limits to the hard limits of its own process', async () => {
      const hostAddressSpace = 2560 * MIB;
      const { report } = startHost(
        { entry: 'stand-in', mode: 'report-self' },
        {
          env: { [SERVICE_TOKEN_NAME]: 'spec-token' },
          hostLimits: [
            `--as=${hostAddressSpace}:${hostAddressSpace}`,
            '--cpu=30:30',
          ],
        },
      );

      const outcome = await within(report);
      const { limits } = selfReportOf(outcome);

      expect(limitRow(limits, 'Max address space')).toEqual([
        String(hostAddressSpace),
        String(hostAddressSpace),
      ]);
      expect(limitRow(limits, 'Max cpu time')).toEqual(['30', '30']);
    });
  },
);
