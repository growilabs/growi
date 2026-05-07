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
export declare function spawnUploadPack(opts: SpawnOptions): SpawnResult;
