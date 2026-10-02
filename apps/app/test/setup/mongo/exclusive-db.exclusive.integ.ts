/**
 * Guard for the isolation the `app-integration-exclusive` vitest project promises.
 *
 * Files in that project empty whole collections, so they may not share a database with
 * anything else. One piece of configuration makes that true — `provide: { testDbNamespace }`,
 * which puts them on a database name no other project's worker is ever given — and it
 * leaves no trace at runtime. If that entry is dropped or renamed, every exclusive test
 * keeps passing while quietly emptying the database the ordinary integration tests are
 * using. (Giving the project a worker of its own instead was tried and does not work; see
 * the comment on the project in vitest.workspace.mts.)
 *
 * This asserts the outcome instead: the database this file is connected to is not the one
 * a worker of any other project would be given.
 */

import mongoose from 'mongoose';

import { getTestDbConfig } from './test-db-config';

describe('app-integration-exclusive database isolation', () => {
  test('connects to a database that no other vitest project can be assigned', () => {
    // Guard the guard: without an open connection the assertions below would compare
    // two computed strings and never touch what the tests actually write to.
    expect(mongoose.connection.readyState).toBe(1);

    const { dbName, workerId } = getTestDbConfig();

    expect(mongoose.connection.name).toBe(dbName);
    // `growi_test_<workerId>` is what a worker outside this project computes, and the
    // worker ids of the two pools are numbered from 1 independently — so sharing this
    // name means sharing the database.
    expect(dbName).not.toBe(`growi_test_${workerId}`);
  });
});
