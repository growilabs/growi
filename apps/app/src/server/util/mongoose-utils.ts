import type { ConnectOptions, Document, Model } from 'mongoose';
import mongoose from 'mongoose';

// suppress DeprecationWarning: current Server Discovery and Monitoring engine is deprecated, and will be removed in a future version
type ConnectionOptionsExtend = {
  useUnifiedTopology: boolean;
};

const DEFAULT_MAX_POOL_SIZE = 15;
const DEFAULT_MIN_POOL_SIZE = 2;

/**
 * Reads MONGO_MAX_POOL_SIZE and MONGO_MIN_POOL_SIZE from environment variables
 * and returns validated pool size configuration.
 *
 * - Invalid (NaN) values fall back to their respective defaults.
 * - When minPoolSize > maxPoolSize, minPoolSize is clamped to maxPoolSize.
 */
export const getMongoPoolOptions = (): {
  maxPoolSize: number;
  minPoolSize: number;
} => {
  const rawMax = Number(process.env.MONGO_MAX_POOL_SIZE);
  const rawMin = Number(process.env.MONGO_MIN_POOL_SIZE);

  const maxPoolSize = Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_POOL_SIZE;
  const parsedMin = Number.isFinite(rawMin) ? rawMin : DEFAULT_MIN_POOL_SIZE;

  // Clamp minPoolSize so it never exceeds maxPoolSize
  const minPoolSize = Math.min(parsedMin, maxPoolSize);

  return { maxPoolSize, minPoolSize };
};

export const getMongoUri = (): string => {
  const { env } = process;

  return (
    env.MONGOLAB_URI || // for B.C.
    env.MONGODB_URI || // MONGOLAB changes their env name
    env.MONGOHQ_URL ||
    env.MONGO_URI ||
    (env.NODE_ENV === 'test'
      ? 'mongodb://mongo/growi_test'
      : 'mongodb://mongo/growi')
  );
};

export const getModelSafely = <Interface, Method = Interface>(
  modelName: string,
): (Method & Model<Interface & Document>) | null => {
  if (mongoose.modelNames().includes(modelName)) {
    return mongoose.model<
      Interface & Document,
      Method & Model<Interface & Document>
    >(modelName);
  }
  return null;
};

// TODO: Do not use any type
export const getOrCreateModel = <Interface, Method>(
  modelName: string,
  schema: any,
): Method & Model<Interface & Document> => {
  return (
    getModelSafely(modelName) ??
    mongoose.model<Interface & Document, Method & Model<Interface & Document>>(
      modelName,
      schema,
    )
  );
};

// supress deprecation warnings
// useNewUrlParser no longer necessary
// see: https://mongoosejs.com/docs/migrating_to_6.html#no-more-deprecation-warning-options
export const mongoOptions: ConnectOptions & ConnectionOptionsExtend = {
  useUnifiedTopology: true,
  ...getMongoPoolOptions(),
};
