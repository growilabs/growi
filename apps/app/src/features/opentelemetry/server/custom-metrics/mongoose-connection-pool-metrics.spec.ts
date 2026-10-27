import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import {
  addMongooseConnectionPoolMetrics,
  getPoolStats,
} from './mongoose-connection-pool-metrics';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@opentelemetry/api', () => ({
  diag: {
    createComponentLogger: vi.fn(() => ({ error: vi.fn() })),
  },
  metrics: {
    getMeter: vi.fn(),
  },
}));

const { mockGetClient } = vi.hoisted(() => ({
  mockGetClient: vi.fn(),
}));
vi.mock('mongoose', () => ({
  default: {
    connection: { getClient: mockGetClient },
  },
}));

// ---- helpers ----

function makePool(
  total: number,
  checkedOut: number,
  available: number,
): {
  totalConnectionCount: number;
  currentCheckedOutCount: number;
  availableConnectionCount: number;
} {
  return {
    totalConnectionCount: total,
    currentCheckedOutCount: checkedOut,
    availableConnectionCount: available,
  };
}

function makeClient(
  servers: Map<string, { s?: { pool?: ReturnType<typeof makePool> } }>,
) {
  return {
    topology: {
      s: { servers },
    },
  };
}

// ---- getPoolStats unit tests ----

describe('getPoolStats', () => {
  it('returns zeros when client has no topology', () => {
    expect(getPoolStats({})).toEqual({ total: 0, checkedOut: 0, available: 0 });
  });

  it('returns zeros when topology.s is missing', () => {
    expect(getPoolStats({ topology: {} })).toEqual({
      total: 0,
      checkedOut: 0,
      available: 0,
    });
  });

  it('returns zeros when servers map is empty', () => {
    const client = makeClient(new Map());
    expect(getPoolStats(client)).toEqual({
      total: 0,
      checkedOut: 0,
      available: 0,
    });
  });

  it('returns pool stats for a single server', () => {
    const pool = makePool(5, 2, 3);
    const client = makeClient(new Map([['localhost:27017', { s: { pool } }]]));
    expect(getPoolStats(client)).toEqual({
      total: 5,
      checkedOut: 2,
      available: 3,
    });
  });

  it('sums stats across multiple servers', () => {
    const pool1 = makePool(3, 1, 2);
    const pool2 = makePool(4, 2, 2);
    const client = makeClient(
      new Map([
        ['host1:27017', { s: { pool: pool1 } }],
        ['host2:27017', { s: { pool: pool2 } }],
      ]),
    );
    expect(getPoolStats(client)).toEqual({
      total: 7,
      checkedOut: 3,
      available: 4,
    });
  });

  it('skips servers with no pool', () => {
    const pool = makePool(2, 1, 1);
    const client = makeClient(
      new Map([
        ['host1:27017', { s: { pool } }],
        ['host2:27017', {}],
      ]),
    );
    expect(getPoolStats(client)).toEqual({
      total: 2,
      checkedOut: 1,
      available: 1,
    });
  });

  it('treats undefined pool fields as 0', () => {
    const client = makeClient(
      new Map([
        ['localhost:27017', { s: { pool: {} as ReturnType<typeof makePool> } }],
      ]),
    );
    expect(getPoolStats(client)).toEqual({
      total: 0,
      checkedOut: 0,
      available: 0,
    });
  });

  it('returns zeros and does not throw when an error is thrown internally', () => {
    const badClient = {
      get topology(): never {
        throw new Error('unexpected');
      },
    };
    expect(() => getPoolStats(badClient)).not.toThrow();
    expect(getPoolStats(badClient)).toEqual({
      total: 0,
      checkedOut: 0,
      available: 0,
    });
  });
});

// ---- addMongooseConnectionPoolMetrics unit tests ----

describe('addMongooseConnectionPoolMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockPoolSizeGauge = mock<ObservableGauge>();
  const mockCheckedOutGauge = mock<ObservableGauge>();
  const mockAvailableGauge = mock<ObservableGauge>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge
      .mockReturnValueOnce(mockPoolSizeGauge)
      .mockReturnValueOnce(mockCheckedOutGauge)
      .mockReturnValueOnce(mockAvailableGauge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns early without registering meters when getClient() returns null', () => {
    mockGetClient.mockReturnValue(null);
    addMongooseConnectionPoolMetrics();
    expect(metrics.getMeter).not.toHaveBeenCalled();
  });

  it('creates meter with correct name and version', () => {
    mockGetClient.mockReturnValue({ topology: { s: { servers: new Map() } } });
    addMongooseConnectionPoolMetrics();
    expect(metrics.getMeter).toHaveBeenCalledWith(
      'growi-mongoose-metrics',
      '1.0.0',
    );
  });

  it('creates three ObservableGauges with the correct names', () => {
    mockGetClient.mockReturnValue({ topology: { s: { servers: new Map() } } });
    addMongooseConnectionPoolMetrics();

    const names = mockMeter.createObservableGauge.mock.calls.map(
      ([name]) => name,
    );
    expect(names).toEqual([
      'growi.mongoose.pool.size',
      'growi.mongoose.pool.checked_out',
      'growi.mongoose.pool.available',
    ]);
  });

  it('creates all gauges with unit {connection}', () => {
    mockGetClient.mockReturnValue({ topology: { s: { servers: new Map() } } });
    addMongooseConnectionPoolMetrics();

    for (const [, options] of mockMeter.createObservableGauge.mock.calls) {
      expect(options).toMatchObject({ unit: '{connection}' });
    }
  });

  it('registers a batch callback covering all three gauges', () => {
    mockGetClient.mockReturnValue({ topology: { s: { servers: new Map() } } });
    addMongooseConnectionPoolMetrics();

    expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledTimes(1);
    const [, gauges] = mockMeter.addBatchObservableCallback.mock.calls[0];
    expect(gauges).toContain(mockPoolSizeGauge);
    expect(gauges).toContain(mockCheckedOutGauge);
    expect(gauges).toContain(mockAvailableGauge);
  });

  it('observes correct pool stats in the callback', async () => {
    const pool = makePool(10, 3, 7);
    const client = makeClient(new Map([['localhost:27017', { s: { pool } }]]));
    mockGetClient.mockReturnValue(client);

    addMongooseConnectionPoolMetrics();

    const mockResult = { observe: vi.fn() };
    const [callback] = mockMeter.addBatchObservableCallback.mock.calls[0];
    await callback(mockResult);

    expect(mockResult.observe).toHaveBeenCalledWith(mockPoolSizeGauge, 10);
    expect(mockResult.observe).toHaveBeenCalledWith(mockCheckedOutGauge, 3);
    expect(mockResult.observe).toHaveBeenCalledWith(mockAvailableGauge, 7);
  });

  it('observes zeros when the topology has no servers', async () => {
    mockGetClient.mockReturnValue(makeClient(new Map()));
    addMongooseConnectionPoolMetrics();

    const mockResult = { observe: vi.fn() };
    const [callback] = mockMeter.addBatchObservableCallback.mock.calls[0];
    await callback(mockResult);

    expect(mockResult.observe).toHaveBeenCalledWith(mockPoolSizeGauge, 0);
    expect(mockResult.observe).toHaveBeenCalledWith(mockCheckedOutGauge, 0);
    expect(mockResult.observe).toHaveBeenCalledWith(mockAvailableGauge, 0);
  });

  it('reflects updated pool stats across multiple callback invocations', async () => {
    const pool = makePool(2, 1, 1);
    const servers = new Map([['localhost:27017', { s: { pool } }]]);
    mockGetClient.mockReturnValue(makeClient(servers));

    addMongooseConnectionPoolMetrics();

    const mockResult = { observe: vi.fn() };
    const [callback] = mockMeter.addBatchObservableCallback.mock.calls[0];

    await callback(mockResult);
    expect(mockResult.observe).toHaveBeenCalledWith(mockPoolSizeGauge, 2);

    // Simulate pool growth
    pool.totalConnectionCount = 8;
    pool.currentCheckedOutCount = 5;
    pool.availableConnectionCount = 3;

    await callback(mockResult);
    expect(mockResult.observe).toHaveBeenCalledWith(mockPoolSizeGauge, 8);
    expect(mockResult.observe).toHaveBeenCalledWith(mockCheckedOutGauge, 5);
    expect(mockResult.observe).toHaveBeenCalledWith(mockAvailableGauge, 3);
  });
});
