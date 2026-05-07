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
 * left unconfigured rather than set explicitly; this prevents clients from
 * fetching arbitrary OIDs that are not advertised in the namespace view
 * (requirement 5.4).
 */
import { spawn } from 'node:child_process';

import { getRepoPath } from './vault-repo-storage.js';
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
export function spawnUploadPack(opts) {
  const { mode, viewRef, stdin } = opts;
  const repoPath = getRepoPath();
  // Build the argument list based on mode.
  const args =
    mode === 'advertise'
      ? ['upload-pack', '--stateless-rpc', '--advertise-refs', repoPath]
      : ['upload-pack', '--stateless-rpc', repoPath];
  // Spawn the process with GIT_NAMESPACE so git only sees the view ref's
  // namespace (gitnamespaces(7): refs are rewritten to refs/namespaces/<ns>/).
  const child = spawn('git', args, {
    env: {
      ...process.env,
      GIT_NAMESPACE: viewRef,
    },
    // Use a pipe for all standard streams so we can control data flow.
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // In 'rpc' mode, pipe the caller-supplied readable into child stdin so that
  // the git process can read the client's want/have lines.
  if (mode === 'rpc' && stdin != null) {
    stdin.pipe(child.stdin);
  } else {
    // In 'advertise' mode git does not read stdin; close it immediately to
    // prevent the process from hanging waiting for input.
    child.stdin?.end();
  }
  // Build a promise that resolves once the process exits.
  const exitCode = new Promise((resolve) => {
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    exitCode,
    kill() {
      // SIGKILL ensures prompt termination even if the process ignores SIGTERM.
      child.kill('SIGKILL');
    },
  };
}
//# sourceMappingURL=vault-upload-pack-spawner.js.map
