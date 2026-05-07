import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

// 90 days in seconds
const TTL_SECONDS = 60 * 60 * 24 * 90; // 7776000

export const ExtractionFailureReasonCode = {
  unsupportedFormat: 'unsupportedFormat',
  fileTooLarge: 'fileTooLarge',
  extractionTimeout: 'extractionTimeout',
  serviceBusy: 'serviceBusy',
  serviceUnreachable: 'serviceUnreachable',
  extractionFailed: 'extractionFailed',
} as const;

export type ExtractionFailureReasonCode =
  (typeof ExtractionFailureReasonCode)[keyof typeof ExtractionFailureReasonCode];

export interface IExtractionFailureLog {
  attachmentId: string;
  pageId: string | null;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  reasonCode: ExtractionFailureReasonCode;
  message: string | null;
  occurredAt: Date;
  /** Hash of (attachmentId + reasonCode) — used to suppress duplicate entries within a time window */
  retentionGroupHash: string;
}

export interface IExtractionFailureLogDocument
  extends IExtractionFailureLog,
    Document {}

export interface IExtractionFailureLogModel
  extends Model<IExtractionFailureLogDocument> {}

const extractionFailureLogSchema = new Schema<
  IExtractionFailureLogDocument,
  IExtractionFailureLogModel
>({
  attachmentId: { type: String, required: true, index: true },
  pageId: { type: String, default: null },
  fileName: { type: String, required: true },
  fileFormat: { type: String, required: true },
  fileSize: { type: Number, required: true },
  reasonCode: {
    type: String,
    enum: Object.values(ExtractionFailureReasonCode),
    required: true,
  },
  message: { type: String, default: null },
  occurredAt: { type: Date, required: true },
  retentionGroupHash: { type: String, required: true, index: true },
});

// TTL index: MongoDB auto-deletes documents 90 days after occurredAt
extractionFailureLogSchema.index(
  { occurredAt: 1 },
  { expireAfterSeconds: TTL_SECONDS },
);

export const ExtractionFailureLog = getOrCreateModel<
  IExtractionFailureLogDocument,
  IExtractionFailureLogModel
>('ExtractionFailureLog', extractionFailureLogSchema);

export { TTL_SECONDS as EXTRACTION_FAILURE_LOG_TTL_SECONDS };
