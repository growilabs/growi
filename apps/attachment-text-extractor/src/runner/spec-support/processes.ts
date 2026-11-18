import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Linux-only process inspection through /proc, shared by the runner and child
// integration tests. vitest runs each test file in its own process, so the
// children of `process.pid` are the ones this file's tests started.

export type ProcessState = 'alive' | 'zombie' | 'gone';

/** PIDs of a process's direct children, zombies included. */
export const childPids = (pid: number = process.pid): number[] => {
  let tasks: string[];
  try {
    tasks = readdirSync(`/proc/${pid}/task`);
  } catch {
    return [];
  }
  return tasks.flatMap((task) => {
    try {
      return readFileSync(`/proc/${pid}/task/${task}/children`, 'utf8')
        .split(' ')
        .filter((field) => field.trim() !== '')
        .map(Number);
    } catch {
      return [];
    }
  });
};

/** 'zombie' means it has ended and only waits to be reaped. */
export const processState = (pid: number): ProcessState => {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return 'gone';
  }
  // The command name in parentheses may itself contain spaces or ')'.
  const state = stat.slice(
    stat.lastIndexOf(')') + 2,
    stat.lastIndexOf(')') + 3,
  );
  return state === 'Z' || state === 'X' ? 'zombie' : 'alive';
};

export const hasEnded = (pid: number): boolean => processState(pid) !== 'alive';

export const openFdCount = (): number => readdirSync('/proc/self/fd').length;

export const procText = (pid: number, name: string): string =>
  readFileSync(`/proc/${pid}/${name}`, 'utf8');

/** Polls until the predicate holds; false once the time is up. */
export const waitUntil = async (
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 5,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(intervalMs);
  }
  return predicate();
};

/** The single child this process is running, once it has started. */
export const waitForOnlyChild = async (timeoutMs = 20_000): Promise<number> => {
  let found: number | undefined;
  const appeared = await waitUntil(() => {
    const pids = childPids().filter((pid) => processState(pid) === 'alive');
    found = pids.length === 1 ? pids[0] : undefined;
    return found !== undefined;
  }, timeoutMs);
  if (!appeared || found === undefined) {
    throw new Error('no single running child appeared');
  }
  return found;
};

/**
 * afterEach clean-up: kills whatever children a failed test left running and
 * waits for them to end, so one broken case cannot leak into the next.
 */
export const killStrayChildren = async (): Promise<void> => {
  const strays = childPids().filter((pid) => processState(pid) === 'alive');
  for (const pid of strays) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  await waitUntil(() => strays.every(hasEnded), 5_000);
};
