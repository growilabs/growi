import type { Types } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IFailedEmail {
  _id: Types.ObjectId;
  emailConfig: {
    to: string;
    from?: string;
    subject?: string;
    text?: string;
    template?: string;
    vars?: Record<string, unknown>;
  };
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  transmissionMethod: 'smtp' | 'ses' | 'oauth2';
  attempts: number;
  lastAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IFailedEmail>(
  {
    emailConfig: {
      type: Schema.Types.Mixed,
      required: true,
    },
    error: {
      message: { type: String, required: true },
      code: { type: String },
      stack: { type: String },
    },
    transmissionMethod: {
      type: String,
      enum: ['smtp', 'ses', 'oauth2'],
      required: true,
    },
    attempts: {
      type: Number,
      required: true,
      default: 3,
    },
    lastAttemptAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Index for querying failed emails by creation date
schema.index({ createdAt: 1 });

export const FailedEmail = getOrCreateModel<
  IFailedEmail,
  Record<string, never>
>('FailedEmail', schema);
