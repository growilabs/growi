import mongoose, { Schema } from 'mongoose';

// ---- Schema ----
/**
 * Read-only schema covering only the fields that vault-manager accesses.
 * strict: true rejects undeclared fields to enforce the principle of least privilege.
 */
const revisionSchema = new Schema(
  {
    // _id is included by default
    body: { type: String, select: true },
  },
  {
    collection: 'revisions',
    // Do not emit a __v field; we never update revision documents
    versionKey: false,
    // Prevent accidental timestamp writes
    timestamps: false,
    // Reject fields not declared in the schema
    strict: true,
  },
);
// ---- Static implementations ----
revisionSchema.statics.findBodyById = function (id) {
  return this.findOne({ _id: id }, { body: 1 }).lean().exec();
};
revisionSchema.statics.bodyQueryByIds = function (ids) {
  return this.find({ _id: { $in: ids } }, { body: 1 });
};
// ---- Model export ----
/**
 * Read-only Mongoose model for the revisions collection.
 * vault-manager must never call save() or any mutating operation on this model.
 * Only findOne({_id}, {body}) and find({_id: {$in: ids}}, {body}).cursor() patterns are permitted.
 */
export const RevisionModel = mongoose.model('Revision', revisionSchema);
//# sourceMappingURL=revision.js.map
