import type { Collection } from 'mongodb';
import mongoose from 'mongoose';

import migrate from '~/migrations/20210913153942-migrate-slack-app-integration-schema';

describe('migrate-slack-app-integration-schema', () => {
  let collection: Collection;

  beforeAll(async () => {
    collection = mongoose.connection.collection('slackappintegrations');

    await collection.insertMany([
      {
        tokenGtoP: 'tokenGtoP1',
        tokenPtoG: 'tokenPtoG1',
        permissionsForBroadcastUseCommands: { foo: true },
        permissionsForSingleUseCommands: { bar: true },
      },
      {
        tokenGtoP: 'tokenGtoP2',
        tokenPtoG: 'tokenPtoG2',
        supportedCommandsForBroadcastUse: ['foo'],
        supportedCommandsForSingleUse: ['bar'],
      },
      {
        tokenGtoP: 'tokenGtoP3',
        tokenPtoG: 'tokenPtoG3',
      },
    ]);
  });

  test('up is applied successfully', async () => {
    // setup
    const doc1 = await collection.findOne({ tokenGtoP: 'tokenGtoP1' });
    const doc2 = await collection.findOne({ tokenGtoP: 'tokenGtoP2' });
    const doc3 = await collection.findOne({ tokenGtoP: 'tokenGtoP3' });
    expect(doc1 != null).toBeTruthy();
    expect(doc2 != null).toBeTruthy();
    expect(doc3 != null).toBeTruthy();
    expect(doc1).toStrictEqual({
      _id: doc1?._id,
      tokenGtoP: 'tokenGtoP1',
      tokenPtoG: 'tokenPtoG1',
      permissionsForBroadcastUseCommands: {
        foo: true,
      },
      permissionsForSingleUseCommands: {
        bar: true,
      },
    });
    expect(doc2).toStrictEqual({
      _id: doc2?._id,
      tokenGtoP: 'tokenGtoP2',
      tokenPtoG: 'tokenPtoG2',
      supportedCommandsForBroadcastUse: ['foo'],
      supportedCommandsForSingleUse: ['bar'],
    });
    expect(doc3).toStrictEqual({
      _id: doc3?._id,
      tokenGtoP: 'tokenGtoP3',
      tokenPtoG: 'tokenPtoG3',
    });

    // when
    await migrate.up(mongoose.connection.db);

    // then
    const fixedDoc1 = await collection.findOne({ tokenGtoP: 'tokenGtoP1' });
    const fixedDoc2 = await collection.findOne({ tokenGtoP: 'tokenGtoP2' });
    const fixedDoc3 = await collection.findOne({ tokenGtoP: 'tokenGtoP3' });
    expect(fixedDoc1 != null).toBeTruthy();
    expect(fixedDoc2 != null).toBeTruthy();
    expect(fixedDoc3 != null).toBeTruthy();
    expect(fixedDoc1?.supportedCommandsForBroadcastUse).toBeUndefined();
    expect(fixedDoc1?.supportedCommandsForSingleUse).toBeUndefined();
    expect(fixedDoc2?.supportedCommandsForBroadcastUse).toBeUndefined();
    expect(fixedDoc2?.supportedCommandsForSingleUse).toBeUndefined();
    expect(fixedDoc3?.supportedCommandsForBroadcastUse).toBeUndefined();
    expect(fixedDoc3?.supportedCommandsForSingleUse).toBeUndefined();
    expect(fixedDoc1).toStrictEqual({
      _id: doc1?._id,
      tokenGtoP: 'tokenGtoP1',
      tokenPtoG: 'tokenPtoG1',
      permissionsForBroadcastUseCommands: {
        foo: true,
        search: false,
      },
      permissionsForSingleUseCommands: {
        bar: true,
        note: false,
        keep: false,
      },
    });
    expect(fixedDoc2).toStrictEqual({
      _id: doc2?._id,
      tokenGtoP: 'tokenGtoP2',
      tokenPtoG: 'tokenPtoG2',
      permissionsForBroadcastUseCommands: {
        foo: true,
        search: false,
      },
      permissionsForSingleUseCommands: {
        bar: true,
        note: false,
        keep: false,
      },
    });
    expect(fixedDoc3).toStrictEqual({
      _id: doc3?._id,
      tokenGtoP: 'tokenGtoP3',
      tokenPtoG: 'tokenPtoG3',
      permissionsForBroadcastUseCommands: {
        search: true,
      },
      permissionsForSingleUseCommands: {
        note: true,
        keep: true,
      },
    });
  });
});
