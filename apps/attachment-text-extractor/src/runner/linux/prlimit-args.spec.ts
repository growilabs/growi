import {
  addressSpaceLimitBytes,
  cpuTimeLimits,
  type HardLimits,
  PRLIMIT_PATH,
  parseHardLimits,
  prlimitArgs,
} from './prlimit-args';

// Python test_platform_guards.py, with the Node values: the address space is
// MAX_CHILD_RSS_MB + 2,304 MiB (research.md 19.1, not Python's + 512), the core
// limit is 1 (15.11), and the limits go to `prlimit` before node starts (15.1).

const MIB = 1024 * 1024;
const UNLIMITED: HardLimits = {
  addressSpaceBytes: Number.POSITIVE_INFINITY,
  cpuSeconds: Number.POSITIVE_INFINITY,
};
const COMMAND = [
  '/usr/local/bin/node',
  '--wasm-max-mem-pages=8192',
  '/srv/child.js',
];

/** The options before `--`, and what follows it. */
const split = (args: readonly string[]) => {
  const separator = args.indexOf('--');
  return {
    options: args.slice(0, separator),
    command: args.slice(separator + 1),
  };
};

describe('addressSpaceLimitBytes', () => {
  it.each([
    [320, (320 + 2304) * MIB],
    [111, (111 + 2304) * MIB],
  ])('is MAX_CHILD_RSS_MB %i plus 2,304 MiB', (rssMb, bytes) => {
    expect(addressSpaceLimitBytes(rssMb)).toBe(bytes);
  });
});

describe('cpuTimeLimits', () => {
  // hard > soft, so the kernel sends SIGXCPU (timeout) before SIGKILL (crashed).
  it.each([
    [55, 60],
    [0.3, 6],
    [1, 6],
    [54.2, 60],
  ])('gives timeout %s s a soft limit of %i s and a hard limit 5 s above it', (timeoutS, soft) => {
    expect(cpuTimeLimits(timeoutS)).toEqual({ soft, hard: soft + 5 });
  });
});

describe('parseHardLimits', () => {
  const procLimits = (addressSpaceHard: string, cpuHard: string): string =>
    [
      'Limit                     Soft Limit           Hard Limit           Units     ',
      `Max cpu time              unlimited            ${cpuHard.padEnd(20)} seconds   `,
      'Max file size             unlimited            unlimited            bytes     ',
      'Max core file size        0                    unlimited            bytes     ',
      `Max address space         unlimited            ${addressSpaceHard.padEnd(20)} bytes     `,
      'Max open files            1048576              1048576              files     ',
      '',
    ].join('\n');

  it('reads unlimited as infinity', () => {
    expect(parseHardLimits(procLimits('unlimited', 'unlimited'))).toEqual(
      UNLIMITED,
    );
  });

  it('reads the hard column, not the soft one', () => {
    expect(parseHardLimits(procLimits('2147483648', '30'))).toEqual({
      addressSpaceBytes: 2147483648,
      cpuSeconds: 30,
    });
  });
});

describe('prlimitArgs', () => {
  it('is run by absolute path, never looked up through PATH', () => {
    expect(PRLIMIT_PATH).toBe('/usr/bin/prlimit');
  });

  it('sets the address space, the CPU time (soft < hard) and core 1, then runs the command', () => {
    const args = prlimitArgs({
      maxChildRssMb: 320,
      timeoutS: 55,
      hardLimits: UNLIMITED,
      command: COMMAND,
    });

    const { options, command } = split(args);
    expect([...options].sort()).toEqual(
      [`--as=${2624 * MIB}`, '--core=1', '--cpu=60:65'].sort(),
    );
    expect(command).toEqual(COMMAND);
  });

  // A hard limit above the parent's own makes prlimit fail (research.md 15.4 (1)).
  it.each<[string, HardLimits, string, string]>([
    [
      'below both soft limits',
      { addressSpaceBytes: 2048 * MIB, cpuSeconds: 50 },
      `--as=${2048 * MIB}`,
      '--cpu=50:50',
    ],
    [
      'between the CPU soft and hard limits',
      { addressSpaceBytes: 4096 * MIB, cpuSeconds: 63 },
      `--as=${2624 * MIB}`,
      '--cpu=60:63',
    ],
  ])('never asks for more than the parent hard limit %s', (_case, hardLimits, as, cpu) => {
    const { options } = split(
      prlimitArgs({
        maxChildRssMb: 320,
        timeoutS: 55,
        hardLimits,
        command: COMMAND,
      }),
    );

    expect(options).toContain(as);
    expect(options).toContain(cpu);
    expect(options).toContain('--core=1');
  });
});
