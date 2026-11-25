import { readFileSync } from 'node:fs';

import {
  type HardLimits,
  type PrlimitArgsInput,
  parseHardLimits,
  prlimitArgs,
} from './prlimit-args';

export interface SpawnCommand {
  readonly file: string;
  readonly args: readonly string[];
}

const UNLIMITED: HardLimits = {
  addressSpaceBytes: Number.POSITIVE_INFINITY,
  cpuSeconds: Number.POSITIVE_INFINITY,
};

/** Read on every start, so a limit lowered on this process later is still respected. */
export const readOwnHardLimits = (): HardLimits => {
  if (process.platform !== 'linux') {
    return UNLIMITED;
  }
  try {
    return parseHardLimits(readFileSync('/proc/self/limits', 'utf8'));
  } catch {
    return UNLIMITED;
  }
};

/**
 * On Linux the child always runs under prlimit; elsewhere (development
 * machines) it runs as it is, as Python's platform_guards did.
 */
export const limitedCommand = (
  input: PrlimitArgsInput & { readonly prlimitPath: string },
  platform: NodeJS.Platform,
): SpawnCommand => {
  if (platform === 'linux') {
    return { file: input.prlimitPath, args: prlimitArgs(input) };
  }
  const [file = '', ...args] = input.command;
  return { file, args };
};
