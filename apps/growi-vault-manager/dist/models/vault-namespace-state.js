import mongoose, { Schema } from 'mongoose';

// ---- Schema ----
const vaultNamespaceStateSchema = new Schema(
  {
    namespace: { type: String, required: true },
    commitOid: { type: String, required: true },
    version: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'vault_namespace_state',
    versionKey: false,
    timestamps: false,
  },
);
// ---- Indexes ----
/**
 * Unique index on namespace ensures one doc per namespace.
 * Also serves as the lookup key for VaultViewComposer.
 */
vaultNamespaceStateSchema.index({ namespace: 1 }, { unique: true });
// ---- Static implementations ----
vaultNamespaceStateSchema.statics.upsertNamespace = function (
  namespace,
  commitOid,
) {
  return this.findOneAndUpdate(
    { namespace },
    {
      $set: { commitOid, updatedAt: new Date() },
      // Increment version on every update so VaultViewComposer can detect
      // changes without comparing the full commitOid.
      $inc: { version: 1 },
      // On first insert, set the namespace field (not covered by $set filter).
      $setOnInsert: { namespace },
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
        // findOneAndUpdate with upsert:true + new:true should never return null
        throw new Error(
          `VaultNamespaceState upsert returned null for namespace: ${namespace}`,
        );
      }
      return doc;
    });
};
vaultNamespaceStateSchema.statics.findByNamespace = function (namespace) {
  return this.findOne({ namespace }).lean().exec();
};
vaultNamespaceStateSchema.statics.getCommitOidMap = function (namespaces) {
  return this.find(
    { namespace: { $in: namespaces } },
    { namespace: 1, commitOid: 1 },
  )
    .lean()
    .then((docs) =>
      docs.reduce((acc, doc) => {
        acc[doc.namespace] = doc.commitOid;
        return acc;
      }, {}),
    );
};
vaultNamespaceStateSchema.statics.deleteAll = function () {
  // deleteMany returns a DeleteResult; map to void so callers get a clean Promise<void>
  return this.deleteMany({}).then(() => {
    /* intentionally empty — caller only needs the settled signal */
  });
};
// ---- Model export ----
/**
 * Mongoose model for the vault_namespace_state collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export const VaultNamespaceStateModel = mongoose.model(
  'VaultNamespaceState',
  vaultNamespaceStateSchema,
);
//# sourceMappingURL=vault-namespace-state.js.map
