/**
 * Guard for the objects a git client may ask upload-pack for.
 *
 * `GIT_NAMESPACE` scopes ref advertisement, not the object database, and git's
 * reachability check for an unadvertised want assumes the want is a commit. A
 * client that asks for a blob or a tree by object name therefore receives it
 * even when nothing in its own view reaches that object — measured on git
 * 2.49.0, see `.kiro/specs/growi-vault-manager/research.md`. Since
 * gitnamespaces(7) states outright that namespaces are not a read
 * access-control boundary, the check has to happen before upload-pack runs.
 *
 * Two pieces live here:
 * - `peekWantSection` reads just the head of the request body, without
 *   consuming or destroying the stream, so the untouched body can still be
 *   handed to upload-pack (requirement 5.3 — the process keeps streaming, and
 *   only the bounded head is ever held in memory).
 * - `findWantsOutsideView` answers which of those OIDs the view may not serve.
 *   A want is allowed only when it is a commit that the view ref reaches, which
 *   is exactly what a clone, a fetch and a shallow fetch ask for.
 */

import { execFile } from 'node:child_process';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { parseWantSection } from './vault-pkt-line.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of peeking at the head of an upload-pack request body. */
export interface PeekWantSectionResult {
  /** Whether a complete v0 want section was found. */
  readonly status: 'complete' | 'invalid';
  /** OIDs the client asked for; empty when `status` is 'invalid'. */
  readonly wants: readonly string[];
  /**
   * Partial-clone filter specs the client asked to be applied; empty when
   * `status` is 'invalid' or the request carries no filter. Judged by
   * `findUnsupportedFilters` in vault-sparse-filter.ts.
   */
  readonly filters: readonly string[];
  /**
   * The bytes already taken off the stream. The caller must write these to
   * upload-pack's stdin before piping the remainder, or the request body would
   * arrive truncated.
   */
  readonly prefix: Buffer;
  /** Why the request was judged invalid; undefined when it was not. */
  readonly reason?: string;
}

/**
 * Most distinct OIDs a single request may ask about.
 *
 * A view advertises one commit (plus HEAD pointing at it), so a real clone or
 * fetch asks for one — measured across full clone, shallow clone and
 * incremental fetch. The limit exists because each distinct want costs a git
 * process: a 64 KiB want section holds ~1300 want lines, and answering all of
 * them measured 1.3 s of process churn for a single cheap request. Anything
 * past this limit is refused outright rather than answered.
 */
const MAX_DISTINCT_WANTS = 64;

/** Inputs for the reachability check. */
export interface FindWantsOutsideViewOptions {
  /** Absolute path of the bare repository. */
  readonly repoPath: string;
  /** View ref name used as GIT_NAMESPACE (e.g. 'user-<uid>-view'). */
  readonly viewRef: string;
  /** OIDs the client asked for. */
  readonly wants: readonly string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds the full ref path a view's commit lives at.
 *
 * Mirrors `viewRefPath()` in vault-view-composer.ts. The full path is used
 * instead of GIT_NAMESPACE so the helper commands below need no extra
 * environment.
 */
function viewRefPath(viewRef: string): string {
  return `refs/namespaces/${viewRef}/refs/heads/main`;
}

/**
 * Reads the want section from the head of a request stream.
 *
 * The stream is paused rather than iterated to completion: consuming it with
 * `for await` would close the iterator and drop the negotiation that follows
 * the want section, leaving upload-pack waiting for input that never arrives.
 *
 * @param stream - Request body, positioned at the start.
 * @returns The wants, plus the bytes that were taken off the stream.
 */
export function peekWantSection(
  stream: Readable,
): Promise<PeekWantSectionResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      const parsed = parseWantSection(Buffer.concat(chunks));
      if (parsed.status === 'need-more') {
        return;
      }

      // Stop reading and hand the stream back to the caller with whatever is
      // left still queued inside it.
      stream.pause();
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);

      resolve(
        parsed.status === 'complete'
          ? {
              status: 'complete',
              wants: parsed.wants,
              filters: parsed.filters,
              prefix: Buffer.concat(chunks),
            }
          : {
              status: 'invalid',
              wants: [],
              filters: [],
              prefix: Buffer.concat(chunks),
              reason: parsed.reason,
            },
      );
    };

    const onEnd = (): void => {
      const prefix = Buffer.concat(chunks);
      const parsed = parseWantSection(prefix);
      resolve({
        status: 'invalid',
        wants: [],
        filters: [],
        prefix,
        reason:
          parsed.status === 'need-more'
            ? 'request body ended before the want section did'
            : parsed.status === 'invalid'
              ? parsed.reason
              : 'unexpected state',
      });
    };

    const onError = (err: Error): void => {
      reject(err);
    };

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

/**
 * Returns the subset of `wants` the given view may not serve.
 *
 * `git merge-base --is-ancestor <want> <view ref>` answers the whole question in
 * one call: it exits non-zero both when the object is not an ancestor of the
 * view's commit and when it is not a commit at all (a blob or a tree), and it
 * fails when the object or the ref is missing. Every failure mode is a denial,
 * so the check is closed by default.
 *
 * One call measured 1–2 ms against a view holding 20,000 pages with a
 * 1,001-commit chain, and stayed at that figure with 5,000 view refs in the
 * repository: the walk only visits commits, so neither page count nor user
 * count enters into it, and squash keeps the chain short (requirement 6).
 *
 * The work is bounded on purpose. Duplicate wants are collapsed, a request
 * asking about more than MAX_DISTINCT_WANTS distinct OIDs is refused as a
 * whole, and the remaining checks run one at a time — otherwise a single
 * request could spawn one git process per want line it chose to include.
 *
 * @param opts - Repository, view ref and the requested OIDs.
 * @returns The denied OIDs. Empty when every want may be served.
 */
export async function findWantsOutsideView(
  opts: FindWantsOutsideViewOptions,
): Promise<readonly string[]> {
  const { repoPath, viewRef, wants } = opts;

  const distinctWants = [...new Set(wants)];

  if (distinctWants.length > MAX_DISTINCT_WANTS) {
    return distinctWants;
  }

  const denied: string[] = [];
  for (const oid of distinctWants) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose — running these concurrently lets one request spawn a git process per want line
      await execFileAsync('git', [
        '-C',
        repoPath,
        'merge-base',
        '--is-ancestor',
        oid,
        viewRefPath(viewRef),
      ]);
    } catch {
      denied.push(oid);
    }
  }

  return denied;
}
