/**
 * ChangesIndexService — discovers the authenticated user's consecutive-edit runs across pages.
 *
 * Task 2.1 scope: run aggregation logic (buildRuns pure function) and service stub.
 * Pagination (task 2.2) and accessibility flags (task 2.3) are handled in later tasks.
 */

import type { Types } from 'mongoose';

import type { ChangesIndexResult } from '../../interfaces/changes-index';
import type { CursorKey } from '../cursor';

// ---------------------------------------------------------------------------
// Internal data shapes used by the run-building algorithm
// ---------------------------------------------------------------------------

/**
 * A single revision document enriched by `$setWindowFields` (partition by pageId, sorted by
 * createdAt asc, _id asc).
 *
 * `prevAuthor`      — the author of the immediately preceding revision on the same page,
 *                     or null when the current revision is the first on that page.
 * `prevRevisionId`  — the _id of that preceding revision, or null when there is none.
 */
export interface RevisionWithContext {
  readonly _id: Types.ObjectId;
  readonly pageId: Types.ObjectId;
  readonly author: Types.ObjectId;
  readonly createdAt: Date;
  readonly prevAuthor: Types.ObjectId | null;
  readonly prevRevisionId: Types.ObjectId | null;
}

/**
 * A "run" — a maximal contiguous sequence of the user's own edits on a single page that is
 * not interrupted by another author's revision.
 *
 * `fromRevisionId`  — the revision immediately before this run (authored by anyone), i.e. the
 *                     baseline for a diff.  null means the page was created by this run (no
 *                     prior revision exists).
 * `toRevisionId`    — the last revision in this run.
 * `latestUpdatedAt` — equals toRevision.createdAt.
 */
export interface Run {
  readonly pageId: Types.ObjectId;
  readonly fromRevisionId: Types.ObjectId | null;
  readonly toRevisionId: Types.ObjectId;
  readonly authorId: Types.ObjectId;
  readonly latestUpdatedAt: Date;
}

// ---------------------------------------------------------------------------
// Pure algorithm
// ---------------------------------------------------------------------------

/**
 * Given a list of the user's own revisions (already filtered to `author === userId`) enriched
 * with `prevAuthor` / `prevRevisionId` from `$setWindowFields`, group them into runs and return
 * the completed runs.
 *
 * Input must be sorted by (createdAt asc, _id asc) globally — i.e. the same order produced by
 * the MongoDB aggregation pipeline.
 *
 * Each revision starts a new run when `prevAuthor !== userId` (the immediately preceding
 * revision on the same page was either absent or by a different author).  Otherwise it extends
 * the current open run for that page.
 *
 * Because the algorithm emits a run only when it is complete (either another author interrupts
 * or the input ends), every returned run is immutable: its from/to boundaries will not change
 * on subsequent calls with more data.
 *
 * @param revisions - Revisions enriched with window-function fields, sorted (createdAt,_id) asc.
 * @param userId    - The authenticated user's ObjectId (used to detect interruptions).
 * @returns         - Completed runs, in the order their to-revision was encountered.
 */
export const buildRuns = (
  revisions: readonly RevisionWithContext[],
  userId: Types.ObjectId,
): Run[] => {
  // Open (in-progress) run keyed by pageId string.
  const openRuns = new Map<
    string,
    {
      fromRevisionId: Types.ObjectId | null;
      toRevisionId: Types.ObjectId;
      authorId: Types.ObjectId;
      latestUpdatedAt: Date;
      pageId: Types.ObjectId;
    }
  >();

  const completedRuns: Run[] = [];

  for (const rev of revisions) {
    const pageKey = rev.pageId.toString();
    const userIdStr = userId.toString();

    // Determine whether this revision starts a new run.
    // A new run starts when the immediately preceding revision on this page was NOT
    // authored by the current user (including the case where there is no prior revision).
    const prevAuthorStr = rev.prevAuthor?.toString() ?? null;
    const isNewRun = prevAuthorStr !== userIdStr;

    if (isNewRun) {
      // Close any existing open run for this page first.
      const existing = openRuns.get(pageKey);
      if (existing != null) {
        completedRuns.push({
          pageId: existing.pageId,
          fromRevisionId: existing.fromRevisionId,
          toRevisionId: existing.toRevisionId,
          authorId: existing.authorId,
          latestUpdatedAt: existing.latestUpdatedAt,
        });
      }

      // Open a fresh run.  baseline = the revision just before our first edit in this run
      // (null when the page was just created by this revision).
      openRuns.set(pageKey, {
        pageId: rev.pageId,
        fromRevisionId: rev.prevRevisionId,
        toRevisionId: rev._id,
        authorId: rev.author,
        latestUpdatedAt: rev.createdAt,
      });
    } else {
      // Extend the current open run — just advance the tail.
      const open = openRuns.get(pageKey);
      if (open != null) {
        const updated = {
          ...open,
          toRevisionId: rev._id,
          latestUpdatedAt: rev.createdAt,
        };
        openRuns.set(pageKey, updated);
      } else {
        // Defensive: no open run found even though prevAuthor === userId.
        // Treat it as a new run to avoid data loss.
        openRuns.set(pageKey, {
          pageId: rev.pageId,
          fromRevisionId: rev.prevRevisionId,
          toRevisionId: rev._id,
          authorId: rev.author,
          latestUpdatedAt: rev.createdAt,
        });
      }
    }
  }

  // Flush all remaining open runs (considered complete within this query window).
  for (const open of openRuns.values()) {
    completedRuns.push({
      pageId: open.pageId,
      fromRevisionId: open.fromRevisionId,
      toRevisionId: open.toRevisionId,
      authorId: open.authorId,
      latestUpdatedAt: open.latestUpdatedAt,
    });
  }

  return completedRuns;
};

// ---------------------------------------------------------------------------
// Service interface (task 2.2+ will flesh out the implementation)
// ---------------------------------------------------------------------------

export interface NormalizedChangesQuery {
  readonly since?: Date;
  readonly toDate?: Date;
  readonly limit: number;
  readonly cursor?: CursorKey;
}

export interface ChangesIndexService {
  listChanges(
    userId: string,
    query: NormalizedChangesQuery,
  ): Promise<ChangesIndexResult>;
}
