import mongoose, { Schema } from 'mongoose';

// ---- Schema ----
const vaultUserViewSchema = new Schema(
  {
    // null represents the anonymous singleton view
    userId: { type: String, default: null },
    viewRef: { type: String, required: true },
    viewCommitOid: { type: String, required: true },
    mergedTreeOid: { type: String, required: true },
    // Mixed type to allow arbitrary namespace keys; validation is at the service layer
    sourceVersions: { type: Schema.Types.Mixed, required: true, default: {} },
    composedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'vault_user_views',
    versionKey: false,
    timestamps: false,
  },
);
// ---- Indexes ----
/**
 * Sparse unique index on userId:
 * - Unique: at most one view document per user.
 * - Sparse: null values are excluded from the uniqueness constraint,
 *   which allows the single anonymous row (userId: null) to coexist with
 *   user-specific rows without violating uniqueness.
 */
vaultUserViewSchema.index({ userId: 1 }, { unique: true, sparse: true });
// ---- Static implementations ----
vaultUserViewSchema.statics.findByUserId = function (userId) {
  // Explicit null match: sparse index excludes null from the B-tree, but
  // Mongoose falls back to a collection scan and still finds the document.
  return this.findOne({ userId }).lean().exec();
};
vaultUserViewSchema.statics.upsertView = function (userId, data) {
  return this.findOneAndUpdate(
    { userId },
    {
      $set: {
        userId,
        viewRef: data.viewRef,
        viewCommitOid: data.viewCommitOid,
        mergedTreeOid: data.mergedTreeOid,
        sourceVersions: data.sourceVersions,
        composedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  )
    .lean()
    .then((doc) => {
      if (doc == null) {
        throw new Error(
          `VaultUserView upsert returned null for userId: ${userId ?? 'anonymous'}`,
        );
      }
      return doc;
    });
};
vaultUserViewSchema.statics.deleteAll = function () {
  return this.deleteMany({}).then(() => {
    /* intentionally empty — caller only needs the settled signal */
  });
};
// ---- Model export ----
/**
 * Mongoose model for the vault_user_views collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export const VaultUserViewModel = mongoose.model(
  'VaultUserView',
  vaultUserViewSchema,
);
//# sourceMappingURL=vault-user-view.js.map
