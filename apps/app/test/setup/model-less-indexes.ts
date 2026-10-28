import mongoose from 'mongoose';
import { beforeAll } from 'vitest';

import {
  applyIndexMigrations,
  MODEL_LESS_INDEX_MIGRATIONS,
} from './mongo/model-less-index-migrations';

// Must run after mongo/index.ts in setupFiles: it needs the connected db.
// Applied unconditionally: the embedded server never runs migrations, and on
// an external MongoDB the cloned template already has the indexes, which the
// idempotent `up` leaves as they are. (MONGO_URI cannot tell the two apart
// here, since mongo/index.ts overwrites it with the embedded server's URI.)
beforeAll(async () => {
  const { db } = mongoose.connection;
  if (db == null) {
    throw new Error('mongoose must be connected before model-less indexes');
  }
  await applyIndexMigrations(db, MODEL_LESS_INDEX_MIGRATIONS);
});
