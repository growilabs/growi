import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LeveledLog } from '../config/leveled-log';
import { type Settings, toConversionLimits } from '../config/load-settings';
import { toTimerDelayMs } from '../config/timer-delay';
import type { ConversionLimits, ConversionOutcome } from '../contract';
import { resolveFormat } from '../formats/format-table';
import { checkInputSize } from '../formats/input-size';
import { encodeChildHeader } from '../wire/child-header';
import { type ChildWarnings, NO_CHILD_WARNINGS } from '../wire/child-warning';
import {
  maxResultFrameBytes,
  WireProtocolError,
} from '../wire/length-prefixed-json';
import { buildChildEnv } from './child-env';
import { runChild } from './child-run';
import {
  createOnceOnlyWarningLog,
  createReadinessLog,
  faultReason,
  type Launcher,
  logConversion,
} from './diagnostics';
import { limitedCommand, PRLIMIT_PATH, readOwnHardLimits } from './linux';
import {
  PROBE_INPUTS,
  PROBE_LIMITS,
  PROBE_MAX_INPUT_BYTES,
} from './probe-inputs';
import {
  type ProbeConversion,
  probeConversions,
  sharedWhileRunning,
} from './readiness';
import { failed, type RunReading, readReport } from './run-outcome';

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

/** The file as the chunks it arrived in, never joined in the parent (research.md 16.9). */
export interface RunInput {
  readonly chunks: readonly Uint8Array[];
  /** The chunks' total length in bytes. */
  readonly size: number;
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

const MIB = 1024 * 1024;
// Python's DEFAULT_PROBE_TIMEOUT_S; the compose / k8s readiness timeouts
// (15 s and up) leave room above it (research.md 23.7).
const DEFAULT_PROBE_TIMEOUT_S = 10;
// research.md 20.6 / 20.12: on the command line, never in NODE_OPTIONS.
const CHILD_NODE_FLAGS = [
  '--wasm-max-mem-pages=8192',
  '--max-semi-space-size=4',
] as const;
// The built JavaScript, never the TypeScript through a loader (research.md
// 23.5). src/runner/ and dist/runner/ both sit two levels below the package.
const DEFAULT_CHILD_ENTRY: ChildEntry = {
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../dist/child/child-entry.js',
  ),
  nodeArgs: [],
};

export const runnerOptionsFromSettings = (
  settings: Settings,
): ConversionRunnerOptions => ({
  limits: toConversionLimits(settings),
  maxChildRssMb: settings.maxChildRssMb,
  timeoutS: settings.timeoutS,
  maxInputBytes: settings.maxFileSizeMb * MIB,
});

type ChildStart =
  | { readonly header: Buffer }
  | { readonly refusal: RunOutcome };

/** The header for the child, or the answer for a run that must not reach one. */
const prepareChild = (
  input: RunInput,
  options: ConversionRunnerOptions,
): ChildStart => {
  const format = resolveFormat(input.fileName, input.mimeHint);
  // An unknown format still goes to the child, which reports it as unsupported.
  const violation =
    format === null ? null : checkInputSize(format, input.size, options.limits);
  if (violation !== null) {
    return { refusal: failed(violation.failure, violation.detail, 0) };
  }
  try {
    const header = encodeChildHeader({
      fileName: input.fileName,
      mimeHint: input.mimeHint,
      limits: options.limits,
      maxInputBytes: options.maxInputBytes,
    });
    return { header };
  } catch (error) {
    if (!(error instanceof WireProtocolError)) {
      throw error;
    }
    // Only a client-sent name or type can make the header this large: a 422, not a 500 (research.md 27.5).
    return {
      refusal: failed(
        'limit_exceeded',
        'file name or type exceeds the size limit',
        0,
      ),
    };
  }
};

type ChildReading = RunReading & { readonly warnings: ChildWarnings };

const convertInChild = async (
  options: ConversionRunnerOptions,
  input: RunInput,
  timeoutS: number,
  signal: AbortSignal,
): Promise<ChildReading> => {
  const start = prepareChild(input, options);
  if ('refusal' in start) {
    return {
      outcome: start.refusal,
      fault: null,
      warnings: NO_CHILD_WARNINGS,
    };
  }
  const entry = options.childEntry ?? DEFAULT_CHILD_ENTRY;
  const command = limitedCommand(
    {
      prlimitPath: options.prlimitPath ?? PRLIMIT_PATH,
      maxChildRssMb: options.maxChildRssMb,
      timeoutS,
      hardLimits: readOwnHardLimits(),
      command: [
        process.execPath,
        ...CHILD_NODE_FLAGS,
        ...entry.nodeArgs,
        entry.path,
      ],
    },
    process.platform,
  );
  const report = await runChild(
    {
      command,
      env: buildChildEnv(),
      frames: [start.header, input.chunks],
      maxResultFrameBytes: maxResultFrameBytes(options.limits.maxResultBytes),
      maxRssMb: options.maxChildRssMb,
      timeoutMs: toTimerDelayMs(timeoutS),
    },
    signal,
  );
  return { ...readReport(report), warnings: report.warnings };
};

const SILENT: LeveledLog = () => {};

/**
 * `log` gets the diagnostic lines (research.md 7.8); the composition root
 * passes the service's log, and without one nothing is written.
 */
export const createConversionRunner = (
  options: ConversionRunnerOptions,
  log: LeveledLog = SILENT,
): ConversionRunner => {
  const probeTimeoutS = options.probeTimeoutS ?? DEFAULT_PROBE_TIMEOUT_S;
  // The operator's conversion limits may legitimately refuse even the probe
  // files (MAX_PDF_PAGES=0, a tiny MAX_CSV_BYTES); that must not make every
  // pod not ready. The child's RSS limit and prlimit stay as configured.
  const probeOptions: ConversionRunnerOptions = {
    ...options,
    limits: PROBE_LIMITS,
    maxInputBytes: PROBE_MAX_INPUT_BYTES,
  };
  const launcher: Launcher = process.platform === 'linux' ? 'prlimit' : 'node';
  const neverAborted = new AbortController().signal;
  const reportReadiness = createReadinessLog(log);
  const logProbeWarnings = createOnceOnlyWarningLog(log);
  // A probe child that ends abnormally gets no line of its own: it is the
  // not-ready reason, written when that changes.
  const probe: ProbeConversion = async (input, timeoutS) => {
    const { outcome, fault, warnings } = await convertInChild(
      probeOptions,
      input,
      timeoutS,
      neverAborted,
    );
    logProbeWarnings(warnings);
    return {
      outcome,
      faultReason: fault === null ? null : faultReason(fault, launcher),
    };
  };
  const checkReadiness = sharedWhileRunning(async (): Promise<Readiness> => {
    const reason = await probeConversions(probe, PROBE_INPUTS, probeTimeoutS);
    reportReadiness(reason);
    return { ready: reason === null };
  });
  const run: ConversionRunner['run'] = async (input, signal) => {
    const { outcome, fault, warnings } = await convertInChild(
      options,
      input,
      options.timeoutS,
      signal,
    );
    logConversion(log, launcher, fault, warnings);
    return outcome;
  };
  return { run, readiness: checkReadiness };
};
