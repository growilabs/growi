import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import { writeFrame } from '../wire/length-prefixed-json';
import { readStatusMemory, type SpawnCommand } from './linux';
import { type ResultFrameEnding, readResultFrame } from './result-frame';

const RESULT_FD = 3;
const RSS_POLL_MS = 50;
// How long to wait for the exit, or for the result pipe to end, once the other
// side has finished or the child was killed (Python's reap_timeout_s).
const SETTLE_CAP_MS = 2_000;
const KIB = 1024;

export interface ChildRunSpec {
  readonly command: SpawnCommand;
  readonly env: Readonly<Record<string, string>>;
  /** Written to fd 0 in order, one length-prefixed frame each (a frame may come in pieces). */
  readonly frames: readonly (Uint8Array | readonly Uint8Array[])[];
  readonly maxResultFrameBytes: number;
  readonly maxRssMb: number;
  readonly timeoutMs: number;
}

/** Decisions the parent takes on its own; each is recorded before the kill. */
export type ParentDecision =
  | 'timeout'
  | 'memory_exceeded'
  | 'result_too_large'
  | 'aborted';

export type ChildRunEnding =
  | { readonly kind: 'result'; readonly body: Buffer }
  | { readonly kind: 'decided'; readonly decision: ParentDecision }
  | { readonly kind: 'not-started' }
  /** Ended (or was given up on) without a result and without a parent decision. */
  | {
      readonly kind: 'exited';
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    };

export interface ChildRunReport {
  readonly ending: ChildRunEnding;
  /** The largest VmRSS / VmHWM seen; 0 when none could be read. */
  readonly peakRssKib: number;
}

type Decided = Extract<ChildRunEnding, { kind: 'result' | 'decided' }>;

const startChild = (spec: ChildRunSpec): ChildProcess | null => {
  try {
    return spawn(spec.command.file, [...spec.command.args], {
      // 0: input frames, 1/2: logs (discarded), 3: result frame, 4: liveness (never written)
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      env: { ...spec.env },
    });
  } catch {
    // e.g. ENOTDIR is thrown, not emitted
    return null;
  }
};

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const isReadable = (stream: unknown): stream is Readable =>
  stream != null && typeof stream === 'object' && 'read' in stream;

const writeFrames = async (
  stdin: Writable,
  frames: ChildRunSpec['frames'],
): Promise<void> => {
  for (const frame of frames) {
    // biome-ignore lint/performance/noAwaitInLoops: frames must reach the child in order
    await writeFrame(stdin, frame);
  }
  stdin.end();
};

/**
 * One started child, from its start to its reaping. The first decision wins:
 * a result frame, or one the parent takes (deadline, RSS, oversize frame,
 * abort), always recorded before the SIGKILL so the parent's own kill is never
 * read back as a crash. Without either, how the child ended decides.
 */
class ChildSupervision {
  private decided: Decided | null = null;
  private resultEnded = false;
  private settleExpired = false;
  private finished = false;
  private peakRssKib = 0;
  private settleTimer: NodeJS.Timeout | undefined;
  private reapTimer: NodeJS.Timeout | undefined;
  private readonly deadline: NodeJS.Timeout;
  private readonly poll: NodeJS.Timeout;
  private readonly onAbort = (): void =>
    this.decide({ kind: 'decided', decision: 'aborted' });

  constructor(
    private readonly child: ChildProcess,
    private readonly spec: ChildRunSpec,
    private readonly signal: AbortSignal,
    private readonly resolve: (report: ChildRunReport) => void,
  ) {
    this.deadline = setTimeout(
      () => this.decide({ kind: 'decided', decision: 'timeout' }),
      spec.timeoutMs,
    );
    this.poll = setInterval(() => this.checkRss(), RSS_POLL_MS);
    signal.addEventListener('abort', this.onAbort, { once: true });
    this.wireChild();
    this.sampleRss();
  }

  private wireChild(): void {
    const { child } = this;
    // A started child emits 'error' only when a signal cannot be sent; the
    // exit still decides. Without a listener it would end the parent.
    child.on('error', () => {});
    child.on('exit', () => this.settleIfDone());
    for (const stream of child.stdio) {
      // EPIPE from a child that stopped reading must not bring the parent down.
      stream?.on('error', () => {});
    }
    child.stdout?.resume();
    child.stderr?.resume();
    const resultPipe = child.stdio[RESULT_FD];
    if (isReadable(resultPipe)) {
      readResultFrame(resultPipe, this.spec.maxResultFrameBytes, (ending) =>
        this.onResultEnd(ending),
      );
    } else {
      this.resultEnded = true;
    }
    if (child.stdin !== null) {
      // A child that stops reading leaves this pending until clean-up destroys stdin.
      writeFrames(child.stdin, this.spec.frames).catch(() => {});
    }
  }

  /** Synchronous, and only before the exit: a reaped pid may already be reused (research.md 15.4 (7)). */
  private sampleRss(): number | null {
    const { pid } = this.child;
    if (pid === undefined || hasExited(this.child)) {
      return null;
    }
    const memory = readStatusMemory(pid);
    this.peakRssKib = Math.max(
      this.peakRssKib,
      memory?.rssKib ?? 0,
      memory?.hwmKib ?? 0,
    );
    return memory?.rssKib ?? null;
  }

  private checkRss(): void {
    const rssKib = this.sampleRss();
    if (rssKib !== null && rssKib > this.spec.maxRssMb * KIB) {
      this.decide({ kind: 'decided', decision: 'memory_exceeded' });
    }
  }

  private onResultEnd(ending: ResultFrameEnding): void {
    this.resultEnded = true;
    if (ending.kind === 'frame') {
      this.decide({ kind: 'result', body: ending.body });
    } else if (ending.kind === 'oversize') {
      this.decide({ kind: 'decided', decision: 'result_too_large' });
    }
    this.settleIfDone();
  }

  private decide(ending: Decided): void {
    if (this.decided !== null || this.finished) {
      return;
    }
    // The last look at VmHWM before the kill catches a peak a poll may have missed.
    this.sampleRss();
    this.decided = ending;
    this.child.kill('SIGKILL');
    this.settleIfDone();
  }

  // 'exit' can come before the last of fd 3 (research.md 15.7 (e)), and the
  // pipe can end before the exit or stay open past it: each side is awaited
  // for a bounded time once the other is done or the child was killed.
  private settleIfDone(): void {
    if (this.finished) {
      return;
    }
    if (hasExited(this.child) && (this.resultEnded || this.settleExpired)) {
      this.finish(this.endingNow());
      return;
    }
    this.settleTimer ??= setTimeout(
      () => this.onSettleExpired(),
      SETTLE_CAP_MS,
    );
  }

  private onSettleExpired(): void {
    this.settleExpired = true;
    if (hasExited(this.child)) {
      this.finish(this.endingNow());
      return;
    }
    this.child.kill('SIGKILL');
    // Reaping a SIGKILLed child takes milliseconds; this only stops a hang.
    this.reapTimer = setTimeout(
      () => this.finish(this.endingNow()),
      SETTLE_CAP_MS,
    );
  }

  private endingNow(): ChildRunEnding {
    return (
      this.decided ?? {
        kind: 'exited',
        code: this.child.exitCode,
        signal: this.child.signalCode,
      }
    );
  }

  private finish(ending: ChildRunEnding): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    clearTimeout(this.deadline);
    clearInterval(this.poll);
    clearTimeout(this.settleTimer);
    clearTimeout(this.reapTimer);
    this.signal.removeEventListener('abort', this.onAbort);
    for (const stream of this.child.stdio) {
      stream?.destroy();
    }
    // The result body leaves with the report only, never kept here.
    this.decided = null;
    this.resolve({ ending, peakRssKib: this.peakRssKib });
  }
}

/**
 * Starts one child, feeds it, watches its RSS and deadline, and returns only
 * once it has exited and been reaped (or SETTLE_CAP_MS after a kill went
 * unanswered). Never rejects: everything the child does ends up in the report.
 */
export const runChild = (
  spec: ChildRunSpec,
  signal: AbortSignal,
): Promise<ChildRunReport> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({
        ending: { kind: 'decided', decision: 'aborted' },
        peakRssKib: 0,
      });
      return;
    }
    const child = startChild(spec);
    if (child === null) {
      resolve({ ending: { kind: 'not-started' }, peakRssKib: 0 });
      return;
    }
    if (child.pid === undefined) {
      // A failed start (ENOENT, EACCES, EMFILE) is reported by an 'error' on
      // the next tick, with no 'exit'; on EMFILE / ENFILE child.stdio is never set.
      child.once('error', () => {
        for (const stream of child.stdio ?? []) {
          stream?.destroy();
        }
        resolve({ ending: { kind: 'not-started' }, peakRssKib: 0 });
      });
      return;
    }
    new ChildSupervision(child, spec, signal, resolve);
  });
