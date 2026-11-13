// Never looked up through PATH: the child's environment has no PATH, and a
// PATH lookup would let whoever controls it choose what wraps the child.
export const PRLIMIT_PATH = '/usr/bin/prlimit';

const MIB = 1024 * 1024;
// research.md 19.1: V8, the watch worker and the PDFium WASM reservation need
// this much address space above the RSS limit.
const ADDRESS_SPACE_HEADROOM_MIB = 2304;
const CPU_TIME_HEADROOM_S = 5;
// soft < hard: at the soft limit the kernel sends SIGXCPU (timeout), at the
// hard limit SIGKILL, which reads as a crash.
const CPU_HARD_EXTRA_S = 5;
// Not 0: with a piped core_pattern the kernel ignores 0 but treats 1 as "no
// core" (research.md 15.4 (1'), 15.11).
const CORE_LIMIT_BYTES = 1;

/** The parent's hard limits; `unlimited` is Infinity. */
export interface HardLimits {
  readonly addressSpaceBytes: number;
  readonly cpuSeconds: number;
}

export interface PrlimitArgsInput {
  readonly maxChildRssMb: number;
  readonly timeoutS: number;
  readonly hardLimits: HardLimits;
  readonly command: readonly string[];
}

export const addressSpaceLimitBytes = (maxChildRssMb: number): number =>
  (maxChildRssMb + ADDRESS_SPACE_HEADROOM_MIB) * MIB;

export const cpuTimeLimits = (
  timeoutS: number,
): { readonly soft: number; readonly hard: number } => {
  const soft = Math.ceil(timeoutS) + CPU_TIME_HEADROOM_S;
  return { soft, hard: soft + CPU_HARD_EXTRA_S };
};

const hardColumn = (procLimitsText: string, rowName: string): number => {
  const row = procLimitsText
    .split('\n')
    .find((line) => line.startsWith(rowName));
  const hard = row?.slice(rowName.length).trim().split(/\s+/)[1];
  if (hard === undefined || hard === 'unlimited') {
    return Number.POSITIVE_INFINITY;
  }
  const value = Number(hard);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

/** Reads the text of /proc/<pid>/limits; a missing row counts as unlimited. */
export const parseHardLimits = (procLimitsText: string): HardLimits => ({
  addressSpaceBytes: hardColumn(procLimitsText, 'Max address space'),
  cpuSeconds: hardColumn(procLimitsText, 'Max cpu time'),
});

/**
 * Asking for a hard limit above the parent's own makes prlimit fail and every
 * run crash (research.md 15.4 (1)), so each value is clamped to it.
 */
export const prlimitArgs = (input: PrlimitArgsInput): readonly string[] => {
  const { addressSpaceBytes, cpuSeconds } = input.hardLimits;
  const cpu = cpuTimeLimits(input.timeoutS);
  const addressSpace = Math.min(
    addressSpaceLimitBytes(input.maxChildRssMb),
    addressSpaceBytes,
  );
  return [
    `--as=${addressSpace}`,
    `--cpu=${Math.min(cpu.soft, cpuSeconds)}:${Math.min(cpu.hard, cpuSeconds)}`,
    `--core=${CORE_LIMIT_BYTES}`,
    '--',
    ...input.command,
  ];
};
