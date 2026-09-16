/**
 * The single way every script in this directory reports its result.
 *
 * - Success: one line of JSON on stdout — `{"ok":true, ...facts}` — exit 0.
 * - Precondition not met: nothing on stdout, one line of reason on stderr,
 *   exit 2. The procedures route exit 2 into their existing "could not be
 *   measured" path, so an empty success must never stand in for it.
 * - An unexpected exception leaves the process at exit 1; the procedures treat
 *   that the same way as exit 2.
 *
 * "Zero rows" is a fact, not a failure: it is `ok:true` with an empty array.
 *
 * Multi-row scripts (a row per issue, per run, per page) follow one more rule:
 * when a single row's value cannot be read, that is a field on **that row**
 * (`pausedAtStatus: UNAVAILABLE`, and the value itself `null`) while the whole
 * result stays `ok:true` — otherwise one unreadable issue would hide every
 * other row. Only when no row at all can be produced does the script fail with
 * exit 2.
 */
import { writeSync } from 'node:fs';

export type Facts = Record<string, unknown>;
export type Failure = { readonly reason: string };
export type ScriptResult =
  | { readonly ok: true; readonly facts: Facts }
  | { readonly ok: false; readonly failure: Failure };

/** What a row uses for a value it could not read. */
export const UNAVAILABLE = 'unavailable';

export const SUCCESS_EXIT_CODE = 0;
export const PRECONDITION_EXIT_CODE = 2;

export type EmitParts = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

const toSingleLine = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** Renders a result into the exact bytes and exit code `emit` would produce. */
export const format = (result: ScriptResult): EmitParts => {
  if (!result.ok) {
    const reason = toSingleLine(result.failure.reason);
    if (reason === '') {
      throw new Error('a failure must carry a non-empty reason');
    }
    return {
      stdout: '',
      stderr: `${reason}\n`,
      exitCode: PRECONDITION_EXIT_CODE,
    };
  }

  if (Object.hasOwn(result.facts, 'ok')) {
    throw new Error('`ok` is reserved and cannot be used as a fact name');
  }
  // Throws a TypeError on a circular structure, which is the intended outcome:
  // a script must not report half-serialized facts as a success.
  const json = JSON.stringify({ ok: true, ...result.facts });
  return { stdout: `${json}\n`, stderr: '', exitCode: SUCCESS_EXIT_CODE };
};

/** Writes the result and ends the process. */
export const emit = (result: ScriptResult): never => {
  const { stdout, stderr, exitCode } = format(result);
  if (stdout !== '') {
    writeSync(process.stdout.fd, stdout);
  }
  if (stderr !== '') {
    writeSync(process.stderr.fd, stderr);
  }
  process.exit(exitCode);
};
