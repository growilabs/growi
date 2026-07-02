import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { ModelCatalog } from '../services/ai-sdk-modules/build-model-catalog';

const SINGLETON_ID = 'singleton';

/**
 * The persisted result of an opt-in model-catalog refresh (Req 9): the
 * models.dev snapshot fetched at runtime, run through the SAME filter and
 * sanity checks as the bundled asset (buildModelCatalog), stored so it
 * survives restarts and is shared across app instances.
 *
 * The effective catalog resolution is "refreshed (this document) if present,
 * otherwise the bundled committed asset" (Req 9.5) — deleting the document
 * simply falls back to the bundled catalog.
 */
export interface IRefreshedModelCatalog {
  /** provider → selectable model ids (same shape/filter as the bundled catalog). */
  models: ModelCatalog;
  /** When the snapshot was fetched from models.dev. */
  fetchedAt: Date;
  /** Upstream attribution (mirrors the bundled asset's `_source`). */
  source: string;
}

export interface RefreshedModelCatalogDocument
  extends IRefreshedModelCatalog,
    Document<string> {}

export interface RefreshedModelCatalogModel
  extends Model<RefreshedModelCatalogDocument> {
  /** The singleton document, or null when no refresh has ever succeeded. */
  getSingleton(): Promise<RefreshedModelCatalogDocument | null>;
  /** Create-or-replace the singleton with a freshly validated snapshot. */
  upsertSingleton(snapshot: IRefreshedModelCatalog): Promise<void>;
}

/**
 * Schema for the mastra_refreshed_model_catalog collection.
 *
 * The collection always contains at most one document with _id === 'singleton'
 * (upserted on each successful refresh). `models` is Mixed because its keys are
 * provider ids; every write goes through buildModelCatalog validation first, so
 * the stored shape is always a validated ModelCatalog.
 */
const refreshedModelCatalogSchema = new Schema<
  RefreshedModelCatalogDocument,
  RefreshedModelCatalogModel
>(
  {
    _id: { type: String, default: SINGLETON_ID },
    models: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
    source: { type: String, required: true },
  },
  {
    collection: 'mastra_refreshed_model_catalog',
    // A long-lived singleton — automatic createdAt/updatedAt would be misleading
    // next to the domain-meaningful fetchedAt.
    timestamps: false,
  },
);

refreshedModelCatalogSchema.statics.getSingleton =
  function (): Promise<RefreshedModelCatalogDocument | null> {
    return this.findById(SINGLETON_ID).exec();
  };

refreshedModelCatalogSchema.statics.upsertSingleton = async function (
  snapshot: IRefreshedModelCatalog,
): Promise<void> {
  await this.updateOne(
    { _id: SINGLETON_ID },
    { $set: snapshot },
    { upsert: true },
  ).exec();
};

export const RefreshedModelCatalog = getOrCreateModel<
  RefreshedModelCatalogDocument,
  RefreshedModelCatalogModel
>('RefreshedModelCatalog', refreshedModelCatalogSchema);
