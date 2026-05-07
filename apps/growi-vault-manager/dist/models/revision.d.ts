import { type Document, type Model } from 'mongoose';
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
/**
 * Read-only Mongoose model for the revisions collection.
 * vault-manager must never call save() or any mutating operation on this model.
 * Only findOne({_id}, {body}) and find({_id: {$in: ids}}, {body}).cursor() patterns are permitted.
 */
export declare const RevisionModel: IRevisionModel;
