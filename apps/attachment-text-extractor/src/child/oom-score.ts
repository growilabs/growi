import { writeFileSync } from 'node:fs';

const OOM_SCORE_ADJ = '1000';

/**
 * Makes the kernel pick this child, not the HTTP process, when the container
 * runs out of memory. Raising the score needs no privilege. Linux only; false
 * when it could not be applied, in which case the child still converts
 * (Python's platform_guards: warn and go on).
 */
export const raiseOomScore = (): boolean => {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    writeFileSync('/proc/self/oom_score_adj', OOM_SCORE_ADJ);
    return true;
  } catch {
    return false;
  }
};
