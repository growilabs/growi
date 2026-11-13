import type { FailureKind } from '../contract';

/**
 * For a child whose result never arrived. SIGXCPU is the kernel's CPU-time
 * soft limit, the backstop for the deadline; every other ending, exit code 0
 * included, is a crash (research.md 15.6).
 */
export const classifyExit = (
  _code: number | null,
  signal: NodeJS.Signals | null,
): FailureKind => (signal === 'SIGXCPU' ? 'timeout' : 'crashed');
