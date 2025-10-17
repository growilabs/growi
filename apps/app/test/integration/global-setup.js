import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';

// check env
if (process.env.NODE_ENV !== 'test') {
  throw new Error("'process.env.NODE_ENV' must be 'test'");
}

module.exports = async () => {
  await mongoose.connect(getMongoUri(), mongoOptions);

  // drop database
  await mongoose.connection.dropDatabase();

  // init DB
  const pageCollection = mongoose.connection.collection('pages');
  const userCollection = mongoose.connection.collection('users');
  const userGroupCollection = mongoose.connection.collection('usergroups');
  const userGroupRelationsCollection =
    mongoose.connection.collection('usergrouprelations');

  // create global user & rootPage
  const globalUser = (
    await userCollection.insertMany([
      {
        name: 'globalUser',
        username: 'globalUser',
        email: 'globalUser@example.com',
      },
    ])
  )[0];
  const gGroupUserId1 = new mongoose.Types.ObjectId();
  const gGroupUserId2 = new mongoose.Types.ObjectId();
  const gGroupUserId3 = new mongoose.Types.ObjectId();

  await userCollection.insertMany([
    {
      name: 'v5DummyUser1',
      username: 'v5DummyUser1',
      email: 'v5DummyUser1@example.com',
    },
    {
      name: 'v5DummyUser2',
      username: 'v5DummyUser2',
      email: 'v5DummyUser2@example.com',
    },
    {
      _id: gGroupUserId1,
      name: 'gGroupUser1',
      username: 'gGroupUser1',
      email: 'gGroupUser1@example.com',
    },
    {
      _id: gGroupUserId2,
      name: 'gGroupUser2',
      username: 'gGroupUser2',
      email: 'gGroupUser2@example.com',
    },
    {
      _id: gGroupUserId3,
      name: 'gGroupUser3',
      username: 'gGroupUser3',
      email: 'gGroupUser3@example.com',
    },
  ]);
  const gGroupIdIsolate = new mongoose.Types.ObjectId();
  const gGroupIdA = new mongoose.Types.ObjectId();
  const gGroupIdB = new mongoose.Types.ObjectId();
  const gGroupIdC = new mongoose.Types.ObjectId();
  await userGroupCollection.insertMany([
    {
      _id: gGroupIdIsolate,
      name: 'globalGroupIsolate',
    },
    {
      _id: gGroupIdA,
      name: 'globalGroupA',
    },
    {
      _id: gGroupIdB,
      name: 'globalGroupB',
      parent: gGroupIdA,
    },
    {
      _id: gGroupIdC,
      name: 'globalGroupC',
      parent: gGroupIdB,
    },
  ]);
  await userGroupRelationsCollection.insertMany([
    {
      relatedGroup: gGroupIdIsolate,
      relatedUser: gGroupUserId1,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdIsolate,
      relatedUser: gGroupUserId2,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdA,
      relatedUser: gGroupUserId1,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdA,
      relatedUser: gGroupUserId2,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdA,
      relatedUser: gGroupUserId3,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdB,
      relatedUser: gGroupUserId2,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdB,
      relatedUser: gGroupUserId3,
      createdAt: new Date(),
    },
    {
      relatedGroup: gGroupIdC,
      relatedUser: gGroupUserId3,
      createdAt: new Date(),
    },
  ]);
  await pageCollection.insertMany([
    {
      path: '/',
      grant: 1,
      creator: globalUser,
      lastUpdateUser: globalUser,
    },
  ]);

  await mongoose.disconnect();
};
