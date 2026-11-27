import { Types } from 'mongoose';

import { normalizeReactionKey } from '~/features/comment-reaction/utils';

import type { OverwriteParams } from '../import-settings';
import type { OverwriteFunction } from '../overwrite-function';

const { ObjectId } = Types;

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

// ObjectId.isValid() also accepts any 12-character string, which would silently turn a
// corrupted value into an unrelated ObjectId.
const restoreObjectId: OverwriteFunction = (value) => {
  if (value instanceof ObjectId) {
    return value;
  }
  if (typeof value === 'string' && OBJECT_ID_HEX.test(value)) {
    return new ObjectId(value);
  }
  return value;
};

// A key that cannot be normalized is kept as is (see research.md, Decision: removal deletes by both the sent and the normalized key).
const normalizeEmoji: OverwriteFunction = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = normalizeReactionKey(value);
  return normalized.ok ? normalized.value : value;
};

// No Mongoose model backs this collection, so convertDocuments casts nothing but `_id` and
// dates; the keys are the stored Mongo field names, not the Prisma field names.
export const generateOverwriteParams = (): OverwriteParams => ({
  comment: restoreObjectId,
  emoji: normalizeEmoji,
  page: restoreObjectId,
  user: restoreObjectId,
});
