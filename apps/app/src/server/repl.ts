import type { REPLServer } from 'node:repl';
import repl from 'node:repl';
import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';

import Crowi from './crowi';

const setupMongoose = async (replServer: REPLServer) => {
  mongoose.Promise = global.Promise;

  await mongoose.connect(getMongoUri(), mongoOptions).then(() => {
    replServer.context.db = mongoose.connection.db;
  });

  replServer.context.mongoose = mongoose;
};

const setupCrowi = async (replServer: REPLServer) => {
  const crowi = new Crowi();
  await crowi.init();
  replServer.context.crowi = crowi;
};

const start = async () => {
  const replServer = repl.start({
    prompt: `${process.env.NODE_ENV} > `,
    ignoreUndefined: true,
  });

  await setupMongoose(replServer);
  await setupCrowi(replServer);
};

start();
