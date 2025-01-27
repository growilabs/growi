
/* eslint-disable no-undef, no-var, vars-on-top, no-restricted-globals, regex/invalid, import/extensions */
// ignore lint error because this file is js as mongoshell

/**
 * @typedef {import('./types').MigrationModule} MigrationModule
 * @typedef {import('./types').ReplaceLatestRevisions} ReplaceLatestRevisions
 * @typedef {import('./types').Operatioins } Operations
 */

var pagesCollection = db.getCollection('pages');
var revisionsCollection = db.getCollection('revisions');

var batchSize = Number(process.env.BATCH_SIZE ?? 100); // default 100 revisions in 1 bulkwrite
var batchSizeInterval = Number(process.env.BATCH_INTERVAL ?? 3000); // default 3 sec

var migrationModule = process.env.MIGRATION_MODULE;

/** @type {MigrationModule[]} */
var migrationModules = require(`./migrations/${migrationModule}`);

if (migrationModules.length === 0) {
  throw Error('No valid migrationModules found. Please enter a valid environment variable');
}

/** @type {ReplaceLatestRevisions} */
function replaceLatestRevisions(body, migrationModules) {
  var replacedBody = body;
  migrationModules.forEach((migrationModule) => {
    replacedBody = migrationModule(replacedBody);
  });
  return replacedBody;
}

/** @type {Operations} */
var operations = [];
pagesCollection.find({}).forEach((/** @type {any} */ doc) => {
  if (doc.revision) {
    try {
      var revision = revisionsCollection.findOne({ _id: doc.revision });

      if (revision == null || revision.body == null) {
        return;
      }

      var replacedBody = replaceLatestRevisions(revision.body, [...migrationModules]);
      var operation = {
        updateOne: {
          filter: { _id: revision._id },
          update: {
            $set: { body: replacedBody },
          },
        },
      };
      operations.push(operation);

      // bulkWrite per 100 revisions
      if (operations.length > (batchSize - 1)) {
        revisionsCollection.bulkWrite(operations);
        // sleep time can be set from env var
        sleep(batchSizeInterval);
        operations = [];
      }
    }
    catch (err) {
      print(`Error in updating revision ${doc.revision}: ${err}`);
    }
  }
});
revisionsCollection.bulkWrite(operations);

print('migration complete!');
