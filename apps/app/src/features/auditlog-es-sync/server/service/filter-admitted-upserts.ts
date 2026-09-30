import type { ActivityDocument } from '~/server/models/activity';

import {
  anonymousSyncThresholdConfigKeys,
  getAnonymousSyncThreshold,
  OTHER_ENDPOINTS_THRESHOLD_KEY,
} from '../config/anonymous-sync-thresholds';
import { decideEsSyncForEvent } from './decide-es-sync-for-event';
import {
  compileThresholdKeyPatterns,
  matchThresholdKey,
} from './match-threshold-key';

// Precompiled once per process — see match-threshold-key.ts for matching semantics.
const thresholdKeyPatterns = compileThresholdKeyPatterns(
  Object.keys(anonymousSyncThresholdConfigKeys),
);

type AdmittableActivity = Pick<
  ActivityDocument,
  '_id' | 'snapshot' | 'endpoint' | 'createdAt'
>;

// Gate anonymous log events (empty snapshot.username): a listed endpoint is counted
// under its own threshold key, any other endpoint under the shared
// OTHER_ENDPOINTS_THRESHOLD_KEY (see anonymous-sync-thresholds.ts). Authenticated logs
// bypass the gate entirely (always admitted).
//
// Used only by the live change-stream consumer (auditlog-changestream.ts). The
// full-corpus reindex (elasticsearch.ts's addAllAuditlogs) deliberately skips it;
// see the comment there.
//
// Events are processed sequentially, not via Promise.all: two anonymous events at the
// same (endpoint, windowStart) admitted in parallel would each open a Mongo
// transaction against the SAME AnonymousSyncCounter document, and the per-event
// early-out read in decideEsSyncForEvent can't see a sibling's still-in-flight
// increment. Serializing avoids that self-inflicted transaction contention during
// exactly the burst traffic this gate exists to survive.
export const filterAdmittedUpserts = async <T extends AdmittableActivity>(
  upserts: T[],
): Promise<T[]> => {
  const admitted: T[] = [];
  for (const activity of upserts) {
    // Truthy, not `!= null`: '' counts as anonymous, matching how elasticsearch.ts
    // builds the indexed document.
    if (activity.snapshot?.username) {
      admitted.push(activity);
      continue;
    }

    // Never indexed (prepareBodyForAuditlog drops a log with neither username nor
    // endpoint), so counting it would only consume the shared budget.
    if (!activity.endpoint) {
      admitted.push(activity);
      continue;
    }

    const thresholdKey =
      matchThresholdKey(thresholdKeyPatterns, activity.endpoint) ??
      OTHER_ENDPOINTS_THRESHOLD_KEY;

    // Keyed by the event's own occurrence time, not the flush wall-clock time: a
    // backlog replayed after a restart (resume token rewound, or a cold start with
    // no token) must land in the windows it actually happened in, not all get bucketed
    // into "now" and exhaust the threshold for unrelated real-time traffic.
    const windowStart = new Date(
      Math.floor(activity.createdAt.getTime() / 60_000) * 60_000,
    );

    // biome-ignore lint/performance/noAwaitInLoops: see the serialization rationale above.
    const decision = await decideEsSyncForEvent(
      activity._id.toString(),
      thresholdKey,
      windowStart,
      getAnonymousSyncThreshold(thresholdKey),
    );
    if (decision === 'admitted') admitted.push(activity);
  }
  return admitted;
};
