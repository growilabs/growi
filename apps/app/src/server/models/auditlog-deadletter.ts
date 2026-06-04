import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '../util/mongoose-utils';

const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export interface IAuditlogDeadletter {
  token: unknown;
  skippedAt: Date;
}

export interface IAuditlogDeadletterDocument
  extends IAuditlogDeadletter,
    Document {}

const auditlogDeadletterSchema = new Schema<IAuditlogDeadletterDocument>(
  {
    token: { type: Schema.Types.Mixed, required: true },
    skippedAt: { type: Date, default: () => new Date(), expires: TTL_SECONDS },
  },
  { collection: 'auditlog_deadletter' },
);

export const AuditlogDeadletter = getOrCreateModel<
  IAuditlogDeadletterDocument,
  Model<IAuditlogDeadletterDocument>
>('AuditlogDeadletter', auditlogDeadletterSchema);
