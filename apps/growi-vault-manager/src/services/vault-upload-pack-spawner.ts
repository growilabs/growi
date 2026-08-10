/**
 * VaultUploadPackSpawner
 *
 * Spawns a `git upload-pack` child process and exposes its stdin/stdout as
 * Node.js streams so that GitProxyController can pipe them directly to/from
 * the HTTP request/response without buffering the entire pack in memory
 * (requirement 5.3 — O(1) memory).
 *
 * Two modes:
 * - 'advertise': `git upload-pack --stateless-rpc --advertise-refs <repoPath>`
 *   Used for GET /internal/git/info/refs to enumerate refs.
 * - 'rpc': `git upload-pack --stateless-rpc <repoPath>`
 *   Used for POST /internal/git/git-upload-pack; request body is piped to stdin.
 *
 * `GIT_NAMESPACE=<viewRef>` is set so that git scopes all ref advertisements
 * and object reachability checks to the per-user view ref namespace
 * (gitnamespaces(7)).
 *
 * `uploadpack.allowAnySHA1InWant=false` is git's default and is therefore
 * left unconfigured rather than set explicitly (requirement 5.4).
 *
 * Note what that setting does and does not buy us: on its own it only stops
 * clients from fetching unadvertised *commits*. Git's reachability check for an
 * unadvertised want assumes the want is a commit, so blobs and trees are served
 * for any OID that exists in the object database, regardless of GIT_NAMESPACE —
 * namespaces scope ref advertisement, not the shared object store, and
 * gitnamespaces(7) states outright that they are not effective for read access
 * control (measured on git 2.49.0).
 *
 * The gap is therefore closed before this spawner runs: GitProxyController
 * authorises every want against the view ref via vault-want-guard.ts, and hands
 * the already-inspected head of the request body back through `stdinPrefix`. Do
 * not call this in 'rpc' mode without that check. See
 * .kiro/specs/growi-vault-manager/research.md.
 *
 * `uploadpack.allowFilter=true` is set so that a client can shrink its clone
 * with `--filter=sparse:oid=<published spec>` (requirement 5.9). The setting is
 * all-or-nothing — git cannot advertise one kind of filter and not another — so
 * the filters this server does not serve are refused by the same guard, which
 * inspects the `filter` line before this spawner runs. Note that
 * `uploadpack.allowReachableSHA1InWant` stays off: a client is never allowed to
 * ask for an object by name, which is why `sparse:oid` (applied entirely on the
 * server, one want, no follow-up request) is the only filter that fits.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import { getRepoPath } from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options for spawning a git upload-pack process. */
export interface SpawnOptions {
  /** Operating mode: advertise refs or serve a stateless-rpc pack request. */
  readonly mode: 'advertise' | 'rpc';
  /**
   * The view ref name (e.g. 'user-<uid>-view' or 'anonymous-view').
   * Set as GIT_NAMESPACE so git scopes all operations to this namespace.
   */
  readonly viewRef: string;
  /**
   * Readable stream to pipe into the process stdin.
   * Required for 'rpc' mode; ignored in 'advertise' mode.
   */
  readonly stdin?: NodeJS.ReadableStream;
  /**
   * Bytes to write to stdin before piping `stdin`.
   *
   * The caller inspects the head of the request body to authorise the client's
   * wants (vault-want-guard.ts), which takes those bytes off the stream; they
   * are replayed here so upload-pack still receives the body in full.
   */
  readonly stdinPrefix?: Buffer;
}

/** Handle returned by spawnUploadPack. */
export interface SpawnResult {
  /** Readable stream connected to the child process stdout. */
  readonly stdout: NodeJS.ReadableStream;
  /** Readable stream connected to the child process stderr. */
  readonly stderr: NodeJS.ReadableStream;
  /** Promise that resolves to the process exit code. */
  readonly exitCode: Promise<number>;
  /** Terminates the child process immediately (SIGKILL). */
  kill(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Spawns `git upload-pack` and returns streaming handles for the caller to
 * wire into the HTTP response.
 *
 * The caller is responsible for:
 * - Piping `result.stdout` to the HTTP response body.
 * - Calling `result.kill()` if the HTTP client disconnects before the process
 *   exits, or if a timeout fires.
 *
 * @param opts - Spawn configuration.
 * @returns Streaming handles and a kill function.
 */
export function spawnUploadPack(opts: SpawnOptions): SpawnResult {
  const { mode, viewRef, stdin, stdinPrefix } = opts;
  const repoPath = getRepoPath();

  // Both modes carry the config: 'advertise' is where the filter capability is
  // announced, 'rpc' is where the filter is applied.
  const config = ['-c', 'uploadpack.allowFilter=true'];

  // Build the argument list based on mode.
  const args =
    mode === 'advertise'
      ? [
          ...config,
          'upload-pack',
          '--stateless-rpc',
          '--advertise-refs',
          repoPath,
        ]
      : [...config, 'upload-pack', '--stateless-rpc', repoPath];

  // Spawn the process with GIT_NAMESPACE so git only sees the view ref's
  // namespace (gitnamespaces(7): refs are rewritten to refs/namespaces/<ns>/).
  const child: ChildProcess = spawn('git', args, {
    env: {
      ...process.env,
      GIT_NAMESPACE: viewRef,
    },
    // Use a pipe for all standard streams so we can control data flow.
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // In 'rpc' mode, pipe the caller-supplied readable into child stdin so that
  // the git process can read the client's want/have lines.
  if (mode === 'rpc' && stdin != null && child.stdin != null) {
    // Replay the already-inspected head first so the body stays byte-identical.
    if (stdinPrefix != null && stdinPrefix.length > 0) {
      child.stdin.write(stdinPrefix);
    }
    stdin.pipe(child.stdin);
  } else {
    // In 'advertise' mode git does not read stdin; close it immediately to
    // prevent the process from hanging waiting for input.
    child.stdin?.end();
  }

  // Build a promise that resolves once the process exits.
  const exitCode = new Promise<number>((resolve) => {
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  return {
    stdout: child.stdout as NodeJS.ReadableStream,
    stderr: child.stderr as NodeJS.ReadableStream,
    exitCode,
    kill(): void {
      // SIGKILL ensures prompt termination even if the process ignores SIGTERM.
      child.kill('SIGKILL');
    },
  };
}
