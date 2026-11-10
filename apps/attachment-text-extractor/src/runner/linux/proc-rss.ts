import { readFileSync } from 'node:fs';

export interface StatusMemory {
  readonly rssKib: number | null;
  readonly hwmKib: number | null;
}

// [ \t]*, not \s*: \s would run past an empty value onto the next line.
const kibField = (statusText: string, name: string): number | null => {
  const match = new RegExp(`^${name}:[ \\t]*(\\d+)[ \\t]*kB$`, 'm').exec(
    statusText,
  );
  return match?.[1] === undefined ? null : Number(match[1]);
};

/** A zombie has no memory lines, so both fields are null for it. */
export const parseStatusMemory = (statusText: string): StatusMemory => ({
  rssKib: kibField(statusText, 'VmRSS'),
  hwmKib: kibField(statusText, 'VmHWM'),
});

/**
 * null when the process no longer exists, and outside Linux. Synchronous on
 * purpose: libuv reaps a child only from the event loop, so a caller that has
 * checked the child has not exited cannot read a reused pid (research.md
 * 15.4 (7)).
 */
export const readStatusMemory = (pid: number): StatusMemory | null => {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    return parseStatusMemory(readFileSync(`/proc/${pid}/status`, 'utf8'));
  } catch {
    return null;
  }
};
