import type { Model } from 'mongoose';
import mongoose from 'mongoose';

/**
 * get a model from collection name
 *
 * @memberOf GrowiBridgeService
 * @param collectionName collection name
 * @return instance of mongoose model
 */
export const getModelFromCollectionName = (
  collectionName: string,
): Model<any, unknown, unknown, unknown, any> | undefined => {
  const models = mongoose
    .modelNames()
    .map((modelName) => mongoose.model(modelName));

  const Model = Object.values(models).find((m) => {
    return m.collection != null && m.collection.name === collectionName;
  });

  return Model;
};
