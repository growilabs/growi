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

/**
 * Result of bodyQueryByIds.
 * query: the Mongoose query filtered to valid ObjectId IDs only.
 * skippedIds: IDs that were excluded because they failed ObjectId validation.
 */
export interface BodyQueryResult {
  readonly query: ReturnType<IRevisionModel['find']>;
  readonly skippedIds: ReadonlyArray<string>;
}

export interface IRevisionModel extends Model<IRevisionDocument> {
  /**
   * Fetch a single revision's body by its _id.
   * Returns null when the revision does not exist.
   * Usage: const rev = await RevisionModel.findBodyById(revisionId);
   */
  findBodyById(id: string): Promise<IRevisionLean | null>;

  /**
   * Returns a { query, skippedIds } result for { _id, body } over the given id list.
   * Only IDs that pass mongoose.Types.ObjectId.isValid() are included in the query.
   * skippedIds contains any IDs that were filtered out due to invalid format.
   * Enables memory-efficient streaming during bulk-upsert instruction processing.
   * Usage: const { query, skippedIds } = RevisionModel.bodyQueryByIds(ids);
   *        const cursor = query.cursor();
   *        for await (const doc of cursor) { ... }
   */
  bodyQueryByIds(ids: ReadonlyArray<string>): BodyQueryResult;
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
): BodyQueryResult {
  const validIds: string[] = [];
  const skippedIds: string[] = [];

  for (const id of ids) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      validIds.push(id);
    } else {
      skippedIds.push(id);
    }
  }

  const query = this.find({ _id: { $in: validIds } }, { body: 1 });
  return { query, skippedIds };
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
