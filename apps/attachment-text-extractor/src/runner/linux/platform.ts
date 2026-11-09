import type { PrlimitArgsInput } from './prlimit-args';

export interface SpawnCommand {
  readonly file: string;
  readonly args: readonly string[];
}

export const limitedCommand = (
  _input: PrlimitArgsInput & { readonly prlimitPath: string },
  _platform: NodeJS.Platform,
): SpawnCommand => {
  throw new Error('not implemented: runner/linux/platform.limitedCommand');
};
