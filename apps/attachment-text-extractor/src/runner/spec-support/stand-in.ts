import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ChildEntry, RunInput } from '../conversion-runner';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../..');

// A file URL, not a bare specifier: `--import` resolves a bare name against the
// child's working directory, which need not hold node_modules.
const SWC_REGISTER_URL = pathToFileURL(
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('@swc-node/register')),
    'esm',
    'esm-register.mjs',
  ),
).href;

/** Node flags that let a child run a TypeScript file from src/ directly. */
export const TS_NODE_ARGS: readonly string[] = ['--import', SWC_REGISTER_URL];

export const tsEntry = (relativeToSrc: string): ChildEntry => ({
  path: path.join(SRC, relativeToSrc),
  nodeArgs: TS_NODE_ARGS,
});

/** stand-in-child.mjs: what it does is chosen by the first line of the file. */
export const STAND_IN_CHILD: ChildEntry = {
  path: path.join(here, 'stand-in-child.mjs'),
  nodeArgs: [],
};

/** Never reads, never answers: waits for the parent to go. */
export const SILENT_CHILD: ChildEntry = {
  path: path.join(here, 'silent-child.mjs'),
  nodeArgs: [],
};

/** A path node cannot load: the child exits with code 1 at once. */
export const MISSING_CHILD: ChildEntry = {
  path: path.join(here, 'no-such-child-entry.mjs'),
  nodeArgs: [],
};

/** A real child entry that imports the real parent watch, then spins forever. */
export const WATCHED_BUSY_CHILD: ChildEntry = tsEntry(
  'child/spec-support/watched-busy-child.ts',
);

export interface StandInOptions {
  readonly argument?: string;
  /** A file the child writes its pid to before anything else. */
  readonly trace?: string;
  readonly fileName?: string;
  readonly mimeHint?: string | null;
  /** Pads the file with 'x' up to this many bytes, mode line included. */
  readonly totalBytes?: number;
}

/** One file in one chunk, as a RunInput carries it. */
export const wholeFile = (
  bytes: Uint8Array,
): Pick<RunInput, 'chunks' | 'size'> => ({
  chunks: [bytes],
  size: bytes.length,
});

/** The file for stand-in-child.mjs: "<mode> <argument> <trace>\n" then padding. */
export const standInInput = (
  mode: string,
  options: StandInOptions = {},
): RunInput => {
  const modeLine = Buffer.from(
    `${mode} ${options.argument ?? '-'} ${options.trace ?? '-'}\n`,
  );
  const total = Math.max(
    options.totalBytes ?? modeLine.length,
    modeLine.length,
  );
  const bytes = Buffer.alloc(total, 'x');
  modeLine.copy(bytes);
  return {
    ...wholeFile(bytes),
    fileName: options.fileName ?? 'stand-in.bin',
    mimeHint: options.mimeHint ?? null,
  };
};

/** A result body the stand-in sends verbatim ('raw-result' mode). */
export const rawResultInput = (body: string, trace?: string): RunInput =>
  standInInput('raw-result', { argument: encodeURIComponent(body), trace });
