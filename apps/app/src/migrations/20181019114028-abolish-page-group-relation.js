import mongoose from 'mongoose';

import pageModelFactory from '~/server/models/page';
import userGroupModelFactory from '~/server/models/user-group';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:abolish-page-group-relation');

async function isCollectionExists(db, collectionName) {
  const collections = await db
    .listCollections({ name: collectionName })
    .toArray();
  return collections.length > 0;
}

/**
 * BEFORE
 *   - 'pagegrouprelations' collection exists (related to models/page-group-relation.js)
 *     - schema:
 *       {
 *         "_id" : ObjectId("5bc9de4d745e137e0424ed89"),
 *         "targetPage" : ObjectId("5b028f13c1f7ba2e58d2fd21"),
 *         "relatedGroup" : ObjectId("5b07e6e6929bad5d3cce9995"),
 *         "__v" : 0
 *       }
 * AFTER
 *   - 'pagegrouprelations' collection is dropped and models/page-group-relation.js is removed
 *   - Page model has 'grantedGroup' field newly
 */
module.exports = {
  async up(db) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const isPagegrouprelationsExists = await isCollectionExists(
      db,
      'pagegrouprelations',
    );
    if (!isPagegrouprelationsExists) {
      logger.info("'pagegrouprelations' collection doesn't exist"); // eslint-disable-line
      logger.info('Migration has successfully applied');
      return;
    }

    const Page = pageModelFactory();
    const UserGroup = userGroupModelFactory();

    // retrieve all documents from 'pagegrouprelations'
    const relations = await db
      .collection('pagegrouprelations')
      .find()
      .toArray();

    /* eslint-disable no-await-in-loop */
    for (const relation of relations) {
      const page = await Page.findOne({ _id: relation.targetPage });

      // skip if grant mismatch
      if (page.grant !== Page.GRANT_USER_GROUP) {
        continue;
      }

      const userGroup = await UserGroup.findOne({ _id: relation.relatedGroup });

      // skip if userGroup does not exist
      if (userGroup == null) {
        continue;
      }

      page.grantedGroup = userGroup;
      await page.save();
    }
    /* eslint-enable no-await-in-loop */

    // drop collection
    await db.collection('pagegrouprelations').drop();

    logger.info('Migration has successfully applied');
  },

  async down(db) {
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const Page = pageModelFactory();
    const UserGroup = userGroupModelFactory();

    // retrieve all Page documents which granted by UserGroup
    const relatedPages = await Page.find({ grant: Page.GRANT_USER_GROUP });
    const insertDocs = [];
    /* eslint-disable no-await-in-loop */
    for (const page of relatedPages) {
      if (page.grantedGroup == null) {
        continue;
      }

      const userGroup = await UserGroup.findOne({ _id: page.grantedGroup });

      // skip if userGroup does not exist
      if (userGroup == null) {
        continue;
      }

      // create a new document for 'pagegrouprelations' collection that is managed by mongoose
      insertDocs.push({
        targetPage: page._id,
        relatedGroup: userGroup._id,
        __v: 0,
      });

      // clear 'grantedGroup' field
      page.grantedGroup = undefined;
      await page.save();
    }
    /* eslint-enable no-await-in-loop */

    if (insertDocs.length > 0) {
      await db.collection('pagegrouprelations').insertMany(insertDocs);
    }

    logger.info('Migration has been successfully rollbacked');
  },
};
