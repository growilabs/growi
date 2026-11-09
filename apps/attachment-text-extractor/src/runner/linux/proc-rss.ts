export interface StatusMemory {
  readonly rssKib: number | null;
  readonly hwmKib: number | null;
}

export const parseStatusMemory = (_statusText: string): StatusMemory => {
  throw new Error('not implemented: runner/linux/proc-rss.parseStatusMemory');
};

/** null when the process no longer exists. */
export const readStatusMemory = (_pid: number): StatusMemory | null => {
  throw new Error('not implemented: runner/linux/proc-rss.readStatusMemory');
};
