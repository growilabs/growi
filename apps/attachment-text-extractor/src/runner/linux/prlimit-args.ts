export const PRLIMIT_PATH = '/usr/bin/prlimit';

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

export const addressSpaceLimitBytes = (_maxChildRssMb: number): number => {
  throw new Error(
    'not implemented: runner/linux/prlimit-args.addressSpaceLimitBytes',
  );
};

export const cpuTimeLimits = (
  _timeoutS: number,
): { readonly soft: number; readonly hard: number } => {
  throw new Error('not implemented: runner/linux/prlimit-args.cpuTimeLimits');
};

export const parseHardLimits = (_procLimitsText: string): HardLimits => {
  throw new Error('not implemented: runner/linux/prlimit-args.parseHardLimits');
};

export const prlimitArgs = (_input: PrlimitArgsInput): readonly string[] => {
  throw new Error('not implemented: runner/linux/prlimit-args.prlimitArgs');
};
