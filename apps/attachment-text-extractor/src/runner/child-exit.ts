import type { FailureKind } from '../contract';

/** For a child whose result never arrived. */
export const classifyExit = (
  _code: number | null,
  _signal: NodeJS.Signals | null,
): FailureKind => {
  throw new Error('not implemented: runner/child-exit.classifyExit');
};
