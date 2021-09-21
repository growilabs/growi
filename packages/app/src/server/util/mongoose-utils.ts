import mongoose, {
  Model, Document, ConnectionOptions, Schema,
} from 'mongoose';

export const initMongooseGlobalSettings = (): void => {
  // supress deprecation warnings
  // see: https://mongoosejs.com/docs/deprecations.html
  mongoose.set('useFindAndModify', false);
  mongoose.set('useCreateIndex', true);
};

export const getMongoUri = (): string => {
  const { env } = process;

  return env.MONGOLAB_URI // for B.C.
    || env.MONGODB_URI // MONGOLAB changes their env name
    || env.MONGOHQ_URL
    || env.MONGO_URI
    || ((env.NODE_ENV === 'test') ? 'mongodb://mongo/growi_test' : 'mongodb://mongo/growi');
};

export const getModelSafely = <T>(modelName: string): Model<T & Document> | null => {
  if (mongoose.modelNames().includes(modelName)) {
    return mongoose.model<T & Document>(modelName);
  }
  return null;
};

export const getOrCreateModel = <Interface, Method>(modelName: string, schema: Schema<Interface>): Method & Model<Interface & Document> => {
  if (mongoose.modelNames().includes(modelName)) {
    return mongoose.model<Interface & Document, Method & Model<Interface & Document>>(modelName);
  }
  return mongoose.model<Interface & Document, Method & Model<Interface & Document>>(modelName, schema);
};

// supress deprecation warnings
// see: https://mongoosejs.com/docs/deprecations.html
export const mongoOptions: ConnectionOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};
