import mongoose from 'mongoose';
import { type MockProxy, mock } from 'vitest-mock-extended';

import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager/config-manager';
import type { SocketIoService } from '~/server/service/socket-io';

import ElasticsearchDelegator from './elasticsearch';
import { injectClient } from './elasticsearch.testing';
import type { ES8ClientDelegator } from './elasticsearch-client-delegator/es8-client-delegator';

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('ElasticsearchDelegator.addAllAuditlogs()', () => {
  let delegator: ElasticsearchDelegator;
  let mockES8Client: MockProxy<ES8ClientDelegator>;

  const setBulkSize = (size: number) => {
    vi.mocked(configManager.getConfig).mockImplementation((key) => {
      if (key === 'app:elasticsearchVersion') return 8;
      if (key === 'app:elasticsearchReindexBulkSize') return size;
      return false;
    });
  };

  // The activities collection has a unique index on (user, target, action,
  // createdAt). addAllAuditlogs only reads snapshot.username, so a distinct action
  // per doc keeps inserts unique without affecting what is asserted.
  let actionSeq = 0;
  const insertActivities = (
    docs: { _id: mongoose.Types.ObjectId; username: string | null }[],
  ) =>
    mongoose.connection.collection('activities').insertMany(
      docs.map((doc) => ({
        _id: doc._id,
        action: `test-action-${actionSeq++}`,
        snapshot: { username: doc.username },
      })),
    );

  beforeEach(async () => {
    setBulkSize(100);

    delegator = new ElasticsearchDelegator(mock<SocketIoService>());

    mockES8Client = mock<ES8ClientDelegator>({ delegatorVersion: 8 });
    mockES8Client.bulk.mockResolvedValue(
      mock<Awaited<ReturnType<typeof mockES8Client.bulk>>>({
        errors: false,
        items: [],
      }),
    );
    injectClient(delegator, mockES8Client);

    await Activity.deleteMany({});
  });

  afterEach(async () => {
    await Activity.deleteMany({});
  });

  it('bulk-indexes every activity into the auditlog index', async () => {
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    await insertActivities([
      { _id: id1, username: 'alice' },
      { _id: id2, username: 'bob' },
    ]);

    await delegator.addAllAuditlogs();

    expect(mockES8Client.bulk).toHaveBeenCalledOnce();
    // The body must target the concrete index, not the alias: during a rebuild the
    // alias points at the tmp index, so indexing via it would write to the wrong index.
    expect(mockES8Client.bulk).toHaveBeenCalledWith({
      body: expect.arrayContaining([
        { index: { _index: 'auditlogs', _id: id1.toString() } },
        { username: 'alice' },
        { index: { _index: 'auditlogs', _id: id2.toString() } },
        { username: 'bob' },
      ]),
    });
  });

  it('does not call bulk when there are no activities', async () => {
    await delegator.addAllAuditlogs();

    expect(mockES8Client.bulk).not.toHaveBeenCalled();
  });

  it('skips activities that have no username', async () => {
    const withName = new mongoose.Types.ObjectId();
    await insertActivities([
      { _id: withName, username: 'alice' },
      { _id: new mongoose.Types.ObjectId(), username: null },
      { _id: new mongoose.Types.ObjectId(), username: '' },
    ]);

    await delegator.addAllAuditlogs();

    expect(mockES8Client.bulk).toHaveBeenCalledWith({
      body: [
        { index: { _index: 'auditlogs', _id: withName.toString() } },
        { username: 'alice' },
      ],
    });
  });

  it('counts every read activity toward progress, not just successfully indexed ones', async () => {
    await insertActivities([
      { _id: new mongoose.Types.ObjectId(), username: 'alice' },
      { _id: new mongoose.Types.ObjectId(), username: null },
      { _id: new mongoose.Types.ObjectId(), username: '' },
    ]);

    const result = await delegator.addAllAuditlogs({
      shouldEmitProgress: true,
    });

    // count must reach totalCount so the client-side progress bar completes,
    // even though only 1 of the 3 activities was actually bulk-indexed.
    expect(result).toEqual({ totalCount: 3, count: 3 });
  });

  it('throws when the bulk response reports indexing errors', async () => {
    await insertActivities([
      { _id: new mongoose.Types.ObjectId(), username: 'alice' },
    ]);
    mockES8Client.bulk.mockResolvedValue(
      mock<Awaited<ReturnType<typeof mockES8Client.bulk>>>({
        errors: true,
        items: [{ index: { error: { type: 'mapper_exception' } } }],
      }),
    );

    await expect(delegator.addAllAuditlogs()).rejects.toThrow(
      'addAllAuditlogs bulk indexing had errors',
    );
  });

  it('throws when the bulk request itself fails', async () => {
    await insertActivities([
      { _id: new mongoose.Types.ObjectId(), username: 'alice' },
    ]);
    mockES8Client.bulk.mockRejectedValue(new Error('ES connection error'));

    await expect(delegator.addAllAuditlogs()).rejects.toThrow(
      'ES connection error',
    );
  });

  it('batches activities according to the configured bulk size', async () => {
    setBulkSize(1);
    await insertActivities([
      { _id: new mongoose.Types.ObjectId(), username: 'alice' },
      { _id: new mongoose.Types.ObjectId(), username: 'bob' },
    ]);

    await delegator.addAllAuditlogs();

    expect(mockES8Client.bulk).toHaveBeenCalledTimes(2);
  });
});
