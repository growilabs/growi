/* eslint-disable no-undef, regex/invalid, import/extensions */
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
  throw Error(
    'No valid migrationModules found. Please enter a valid environment variable',
  );
}

/** @type {ReplaceLatestRevisions} */
function replaceLatestRevisions(body, migrationModules) {
  return migrationModules.reduce(
    (replacedBody, module) => module(replacedBody),
    body,
  );
}

var pipeline = [
  // Join pages with revisions
  {
    $lookup: {
      from: 'revisions',
      localField: 'revision',
      foreignField: '_id',
      as: 'revisionDoc',
    },
  },
  // Unwind the revision array
  {
    $unwind: '$revisionDoc',
  },
  // Project only needed fields
  {
    $project: {
      _id: '$revisionDoc._id',
      body: '$revisionDoc.body',
    },
  },
];

try {
  /** @type {Operations} */
  var operations = [];
  var processedCount = 0;

  var cursor = pagesCollection.aggregate(pipeline, {
    allowDiskUse: true,
    cursor: { batchSize },
  });

  while (cursor.hasNext()) {
    var doc = cursor.next();

    if (doc == null || doc.body == null) {
      continue;
    }

    try {
      var replacedBody = replaceLatestRevisions(doc.body, [
        ...migrationModules,
      ]);

      operations.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: { body: replacedBody },
          },
        },
      });

      processedCount++;

      if (operations.length >= batchSize || !cursor.hasNext()) {
        revisionsCollection.bulkWrite(operations);
        if (batchSizeInterval > 0) {
          sleep(batchSizeInterval);
        }

        operations = [];
      }
    } catch (err) {
      print(`Error processing document ${doc?._id}: ${err}`);
    }
  }

  print('Migration complete!');
  print(`Processed documents count: ${processedCount}`);
} catch (err) {
  print(`Fatal error during migration: ${err}`);
  throw err;
}
