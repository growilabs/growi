import type mongoose from 'mongoose';

import type { ActivityDocument } from '~/server/models/activity';

// Narrow port so the feature needn't depend on the whole ElasticsearchDelegator. Only core
// types cross the boundary, so the delegator satisfies it without importing the feature.
export interface AuditlogEsWriter {
  // Separate args (not ordered ops): an activity is never created and deleted in one batch,
  // so upsert/delete relative order is irrelevant.
  bulkSyncAuditlogs(
    upserts: ActivityDocument[],
    deleteIds: mongoose.Types.ObjectId[],
  ): Promise<void>;
}
