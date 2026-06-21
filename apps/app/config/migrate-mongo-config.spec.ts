import mockRequire from 'mock-require';

const { reRequire } = mockRequire;

describe('config/migrate-mongo-config.js', () => {
  test.concurrent('throws an error when MIGRATIONS_DIR is not set', () => {
    const getMongoUriMock = vi.fn();
    const mongoOptionsMock = vi.fn();

    // mock for mongoose-utils
    mockRequire('../src/server/util/mongoose-utils', {
      getMongoUri: getMongoUriMock,
      mongoOptions: mongoOptionsMock,
    });

    // use reRequire to avoid using module cache
    const caller = () => reRequire('./migrate-mongo-config');

    expect(caller).toThrow('An env var MIGRATIONS_DIR must be set.');

    mockRequire.stop('../src/server/util/mongoose-utils');

    expect(getMongoUriMock).not.toHaveBeenCalled();
  });

  describe.concurrent.each`
    MONGO_URI                                         | expectedDbName
    ${'mongodb://example.com/growi'}                  | ${'growi'}
    ${'mongodb://user:pass@example.com/growi'}        | ${'growi'}
    ${'mongodb://example.com/growi?replicaSet=mySet'} | ${'growi'}
  `('returns', ({ MONGO_URI, expectedDbName }) => {
    beforeEach(async () => {
      process.env.MIGRATIONS_DIR = 'testdir/migrations';
    });

    test(`when 'MONGO_URI' is '${MONGO_URI}`, () => {
      const getMongoUriMock = vi.fn(() => MONGO_URI);
      const mongoOptionsMock = vi.fn();

      // mock for mongoose-utils
      mockRequire('../src/server/util/mongoose-utils', {
        getMongoUri: getMongoUriMock,
        mongoOptions: mongoOptionsMock,
      });

      // use reRequire to avoid using module cache
      const { mongodb, migrationsDir, changelogCollectionName } = reRequire(
        './migrate-mongo-config',
      );

      mockRequire.stop('../src/server/util/mongoose-utils');

      // expect(getMongoUriMock).toHaveBeenCalledOnce();
      expect(mongodb.url).toBe(MONGO_URI);
      expect(mongodb.databaseName).toBe(expectedDbName);
      expect(mongodb.options).toBe(mongoOptionsMock);
      expect(migrationsDir).toBe('testdir/migrations');
      expect(changelogCollectionName).toBe('migrations');
    });
  });
});
