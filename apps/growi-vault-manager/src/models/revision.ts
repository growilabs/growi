import mongoose, { type Document, type Model, Schema } from 'mongoose';

// ---- Interfaces ----

/**
 * Minimal projection of a GROWI Revision document.
 * vault-manager reads only _id and body; all other fields are irrelevant.
 * apps/app is the write owner of the revisions collection.
 */
export interface IRevisionLean {
  readonly _id: string;
  readonly body: string;
}

/**
 * Mongoose document type: omit _id from the lean interface so that
 * Mongoose Document's _id typing takes precedence and avoids TS2320.
 */
export interface IRevisionDocument
  extends Omit<IRevisionLean, '_id'>,
    Document {}

// ---- Model interface ----

export interface IRevisionModel extends Model<IRevisionDocument> {
  /**
   * Fetch a single revision's body by its _id.
   * Returns null when the revision does not exist.
   * Usage: const rev = await RevisionModel.findBodyById(revisionId);
   */
  findBodyById(id: string): Promise<IRevisionLean | null>;

  /**
   * Returns a Mongoose query for { _id, body } over the given id list.
   * Enables memory-efficient streaming during bulk-upsert instruction processing.
   * Usage: const cursor = RevisionModel.bodyQueryByIds(ids); for await (const doc of cursor) { ... }
   */
  bodyQueryByIds(
    ids: ReadonlyArray<string>,
  ): ReturnType<IRevisionModel['find']>;
}

// ---- Schema ----

/**
 * Read-only schema covering only the fields that vault-manager accesses.
 * strict: true rejects undeclared fields to enforce the principle of least privilege.
 */
const revisionSchema = new Schema<IRevisionDocument, IRevisionModel>(
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

revisionSchema.statics.findBodyById = function (
  this: IRevisionModel,
  id: string,
): Promise<IRevisionLean | null> {
  return this.findOne({ _id: id }, { body: 1 }).lean<IRevisionLean>().exec();
};

revisionSchema.statics.bodyQueryByIds = function (
  this: IRevisionModel,
  ids: ReadonlyArray<string>,
) {
  return this.find({ _id: { $in: ids } }, { body: 1 });
};

// ---- Model export ----

/**
 * Read-only Mongoose model for the revisions collection.
 * vault-manager must never call save() or any mutating operation on this model.
 * Only findOne({_id}, {body}) and find({_id: {$in: ids}}, {body}).cursor() patterns are permitted.
 */
export const RevisionModel = mongoose.model<IRevisionDocument, IRevisionModel>(
  'Revision',
  revisionSchema,
);
