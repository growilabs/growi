import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:granted-group-to-array-of-objects');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');

    const pageCollection = await db.collection('pages');
    const pageOperationCollection = await db.collection('pageoperations');
    // Convert grantedGroup to array
    // Set the model type of grantedGroup to UserGroup for Pages that were created before ExternalUserGroup was introduced
    await pageCollection.updateMany({ grantedGroup: { $ne: null } }, [
      {
        $set: {
          grantedGroup: [
            {
              type: 'UserGroup',
              item: '$grantedGroup',
            },
          ],
        },
      },
    ]);

    await pageOperationCollection.updateMany(
      { 'options.grantUserGroupId': { $ne: null } },
      [
        {
          $set: {
            'options.grantUserGroupId': [
              {
                type: 'UserGroup',
                item: '$options.grantUserGroupId',
              },
            ],
          },
        },
      ],
    );

    await pageOperationCollection.updateMany(
      { 'page.grantedGroup': { $ne: null } },
      [
        {
          $set: {
            'page.grantedGroup': [
              {
                type: 'UserGroup',
                item: '$page.grantedGroup',
              },
            ],
          },
        },
      ],
    );

    await pageOperationCollection.updateMany(
      { 'exPage.grantedGroup': { $ne: null } },
      [
        {
          $set: {
            'exPage.grantedGroup': [
              {
                type: 'UserGroup',
                item: '$exPage.grantedGroup',
              },
            ],
          },
        },
      ],
    );

    // rename fields
    await pageCollection.updateMany(
      {},
      {
        $rename: {
          grantedGroup: 'grantedGroups',
        },
      },
    );
    await pageOperationCollection.updateMany(
      {},
      {
        $rename: {
          'options.grantUserGroupId': 'options.grantUserGroupIds',
          'page.grantedGroup': 'page.grantedGroups',
          'exPage.grantedGroup': 'exPage.grantedGroups',
        },
      },
    );

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    logger.info('Rollback migration');

    const pageCollection = await db.collection('pages');
    const pageOperationCollection = await db.collection('pageoperations');

    await pageCollection.updateMany({ grantedGroups: { $exists: true } }, [
      {
        $set: {
          grantedGroups: { $arrayElemAt: ['$grantedGroups.item', 0] },
        },
      },
    ]);
    await pageOperationCollection.updateMany(
      { 'options.grantUserGroupIds': { $exists: true } },
      [
        {
          $set: {
            'options.grantUserGroupIds': {
              $arrayElemAt: ['options.grantUserGroupIds.item', 0],
            },
          },
        },
      ],
    );
    await pageOperationCollection.updateMany(
      { 'page.grantedGroups': { $exists: true } },
      [
        {
          $set: {
            'page.grantedGroups': {
              $arrayElemAt: ['page.grantedGroups.item', 0],
            },
          },
        },
      ],
    );
    await pageOperationCollection.updateMany(
      { 'exPage.grantedGroups': { $exists: true } },
      [
        {
          $set: {
            'exPage.grantedGroups': {
              $arrayElemAt: ['exPage.grantedGroups.item', 0],
            },
          },
        },
      ],
    );

    // rename fields
    await pageCollection.updateMany(
      { grantedGroups: { $exists: true } },
      {
        $rename: {
          grantedGroups: 'grantedGroup',
        },
      },
    );
    await pageOperationCollection.updateMany(
      {},
      {
        $rename: {
          'options.grantUserGroupIds': 'options.grantUserGroupId',
          'page.grantedGroups': 'page.grantedGroup',
          'exPage.grantedGroups': 'exPage.grantedGroup',
        },
      },
    );

    logger.info('Migration has been successfully rollbacked');
  },
};
