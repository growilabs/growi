import type { Settings } from '../config/load-settings';
import type { ConversionLimits, ConversionOutcome } from '../contract';

/** The file a child runs, and the node flags placed before it. */
export interface ChildEntry {
  readonly path: string;
  readonly nodeArgs: readonly string[];
}

export interface ConversionRunnerOptions {
  readonly limits: ConversionLimits;
  readonly maxChildRssMb: number;
  /** Fractions allowed: sub-second deadlines are set here, not via TIMEOUT_S. */
  readonly timeoutS: number;
  readonly maxInputBytes: number;
  /** Used by run() and by the readiness probe; defaults to dist/child/child-entry.js (research.md 23.5). */
  readonly childEntry?: ChildEntry;
  readonly prlimitPath?: string;
  readonly probeTimeoutS?: number;
}

export interface RunInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mimeHint: string | null;
}

export type RunOutcome = ConversionOutcome & {
  readonly childPeakRssMb: number | null;
};

export interface Readiness {
  readonly ready: boolean;
}

export interface ConversionRunner {
  run(input: RunInput, signal: AbortSignal): Promise<RunOutcome>;
  readiness(): Promise<Readiness>;
}

export const runnerOptionsFromSettings = (
  _settings: Settings,
): ConversionRunnerOptions => {
  throw new Error(
    'not implemented: runner/conversion-runner.runnerOptionsFromSettings',
  );
};

export const createConversionRunner = (
  _options: ConversionRunnerOptions,
): ConversionRunner => {
  throw new Error(
    'not implemented: runner/conversion-runner.createConversionRunner',
  );
};
