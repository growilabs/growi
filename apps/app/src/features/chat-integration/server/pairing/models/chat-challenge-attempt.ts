import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * TTL for a challenge-attempt counting window, in seconds. design.md's rate
 * limit is "保留 1 件あたり 1 分 30 回" (30 attempts per pending pairing per
 * minute) -- once a window is a minute old it can never contribute to a
 * still-open window again, so it is safe to let MongoDB reap it after 60s.
 */
export const CHALLENGE_ATTEMPT_WINDOW_TTL_SECONDS = 60;

export interface IChatChallengeAttempt {
  registrationCode: string;
  /**
   * Identifies the request source (derived per protocol spec's "送り元
   * アドレスの決め方", built on `req.ip` under GROWI's `trust proxy`
   * setting). Attempts are rate-limited PER SOURCE, not per pending
   * pairing, because one pending pairing can be probed from many sources
   * (design.md `chat_challenge_attempts` row).
   */
  sourceKey: string;
  /** Start of the current 1-minute counting window. */
  windowStartedAt: Date;
  count: number;
}

export interface ChatChallengeAttemptDocument
  extends IChatChallengeAttempt,
    Document {}

export interface ChatChallengeAttemptModel
  extends Model<ChatChallengeAttemptDocument> {}

const chatChallengeAttemptSchema = new Schema<
  ChatChallengeAttemptDocument,
  ChatChallengeAttemptModel
>(
  {
    registrationCode: { type: String, required: true },
    sourceKey: { type: String, required: true },
    windowStartedAt: { type: Date, required: true, default: () => new Date() },
    count: { type: Number, required: true, default: 0 },
  },
  {
    collection: 'chat_challenge_attempts',
    timestamps: false,
  },
);

// Primary key: (registrationCode, sourceKey). A single row per pending
// pairing would not work -- one pairing is probed from multiple sources
// (design.md).
chatChallengeAttemptSchema.index(
  { registrationCode: 1, sourceKey: 1 },
  { unique: true },
);

chatChallengeAttemptSchema.index(
  { windowStartedAt: 1 },
  { expireAfterSeconds: CHALLENGE_ATTEMPT_WINDOW_TTL_SECONDS },
);

export const ChatChallengeAttempt = getOrCreateModel<
  ChatChallengeAttemptDocument,
  ChatChallengeAttemptModel
>('ChatChallengeAttempt', chatChallengeAttemptSchema);
