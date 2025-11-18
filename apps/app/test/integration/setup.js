/** **********************************************************
 *                           Caution
 *
 * Module aliases by compilerOptions.paths in tsconfig.json
 * are NOT available in setup scripts
 *********************************************************** */

const gc = require('expose-gc/function');
const mongoose = require('mongoose');

const { getMongoUri, mongoOptions } = require('~/server/util/mongoose-utils');

mongoose.Promise = global.Promise;

jest.setTimeout(30000); // default 5000

beforeAll(async () => {
  await mongoose.connect(getMongoUri(), mongoOptions);
});

afterAll(async () => {
  await mongoose.disconnect();
  gc();
});

module.exports = {};
