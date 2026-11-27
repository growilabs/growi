import type { FailureKind } from '../contract';
import { classifyExit } from './child-exit';

// How a child that ended without a complete result frame is classified
// (Python test_conversion_runner.py test_classify_exit; research.md 15.6).
// A result, when one arrived, and the parent's own decisions (timeout,
// memory_exceeded, result_too_large) take precedence; conversion-runner.integ.ts
// covers that order with real children.
describe('classifyExit', () => {
  it.each<[number | null, NodeJS.Signals | null, FailureKind]>([
    // The kernel's CPU-time soft limit: the deadline, not a crash.
    [null, 'SIGXCPU', 'timeout'],
    [null, 'SIGABRT', 'crashed'],
    [null, 'SIGSEGV', 'crashed'],
    // Also what the kernel's OOM killer and a soft = hard CPU limit send.
    [null, 'SIGKILL', 'crashed'],
    // V8 failing to start under RLIMIT_AS (research.md 15.6).
    [null, 'SIGTRAP', 'crashed'],
    // No result means a crash whatever the exit code, 0 included.
    [0, null, 'crashed'],
    [1, null, 'crashed'],
    [3, null, 'crashed'],
    [4, null, 'crashed'],
    [null, null, 'crashed'],
  ])('classifies (code %s, signal %s) as %s', (code, signal, kind) => {
    expect(classifyExit(code, signal)).toBe(kind);
  });
});
