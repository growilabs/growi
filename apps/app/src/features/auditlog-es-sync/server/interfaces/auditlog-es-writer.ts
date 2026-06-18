import type mongoose from 'mongoose';

import type { ActivityDocument } from '~/server/models/activity';

// Narrow port the change stream needs from the ES delegator, so the feature does not
// depend on the whole ElasticsearchDelegator (server core).
export interface AuditlogEsWriter {
  updateOrInsertAuditlog(activity: ActivityDocument): Promise<void>;
  deleteAuditlog(id: mongoose.Types.ObjectId): Promise<void>;
}
