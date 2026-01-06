import {
  vi, describe, beforeAll, beforeEach, it, expect,
} from 'vitest';

import { ContributionAggregationService } from './aggregation-service';

interface MockAggregate {
    exec: () => Promise<any>;
}

describe('ContributionAggregationService', { timeout: 15000 }, () => {
  let service: any;
  let aggregateMockFn: ReturnType<typeof vi.fn>;

  // --- Setup and Teardown ---
  beforeAll(async() => {
    aggregateMockFn = vi.fn();

    vi.doMock('~/server/models/activity', () => {
      const ActivityMock = {
        aggregate: aggregateMockFn,
      };
      return {
        default: ActivityMock,
      };
    });

    vi.doMock('~/interfaces/activity', () => {
      const MOCK_ACTIONS = {
        ACTION_PAGE_CREATED: 'PAGE_CREATE',
        ACTION_PAGE_UPDATED: 'PAGE_UPDATE',
      };
      return {
        ActivityLogActions: MOCK_ACTIONS,
      };
    });

    const { ContributionAggregationService } = await import('./aggregation-service');

    service = new ContributionAggregationService();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should build a pipeline with correct filtering, UTC grouping, and sorting', () => {
    const userId = 'user_123';
    const startDate = new Date('2025-11-01T00:00:00Z');

    // Act
    const pipeline = service.buildPipeline({ userId, startDate });

    // 1. Assert Match Stage
    const match = pipeline.find(s => '$match' in s)?.$match;
    expect(match).toMatchObject({
      userId,
      action: { $in: ['PAGE_CREATE', 'PAGE_UPDATE'] },
      timestamp: {
        $gte: startDate,
        $lt: expect.any(Date),
      },
    });

    // 2. Assert Group Stage
    const group = pipeline.find(s => '$group' in s)?.$group;
    expect(group?._id?.$dateToString).toEqual({
      format: '%Y-%m-%d',
      date: '$timestamp',
      timezone: 'Z',
    });
    expect(group?.count).toEqual({ $sum: 1 });

    // 3. Assert Project Stage
    const project = pipeline.find(s => '$project' in s)?.$project;
    expect(project).toEqual({
      _id: 0,
      d: '$_id',
      c: '$count',
    });

    // 4. Assert Sort Stage
    const sort = pipeline.find(s => '$sort' in s)?.$sort;
    expect(sort).toEqual({ d: 1 });

    expect(pipeline).toHaveLength(4);
  });

  it('should set the endDate to midnight today in UTC', () => {
    const startDate = new Date('2025-01-01');
    const pipeline = service.buildPipeline({ userId: '123', startDate });

    const match = pipeline[0].$match;
    const endDate = match.timestamp.$lt;

    // Verify it's midnight (00:00:00.000)
    expect(endDate.getUTCHours()).toBe(0);
    expect(endDate.getUTCMinutes()).toBe(0);
    expect(endDate.getUTCSeconds()).toBe(0);
  });


  // Test Case 2: Simulates the execution and verifies the final output
  it('should call aggregate with the pipeline and return the result', async() => {
    const userId = 'user_456';
    const startDate = new Date('2025-11-12T00:00:00.000Z');

    const mockDbOutput = [
      { d: '2025-11-12', c: 10 },
      { d: '2025-11-13', c: 3 },
    ];
    const mockExec = vi.fn().mockResolvedValue(mockDbOutput);
    const mockAggregate: MockAggregate = { exec: mockExec };

    aggregateMockFn.mockReturnValue(mockAggregate);

    const result = await service.runAggregationPipeline({ userId, startDate }).exec();

    expect(aggregateMockFn).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockDbOutput);
  });

  // Test Case 3: Ensures an empty array is returned when no results are found
  it('should return an empty array if no activities are found in the range', async() => {
    const userId = 'user_empty';
    const startDate = new Date('2025-11-15T00:00:00.000Z');

    const mockExec = vi.fn().mockResolvedValue([]);
    const mockAggregate: MockAggregate = { exec: mockExec };

    aggregateMockFn.mockReturnValue(mockAggregate);

    const result = await service.runAggregationPipeline({ userId, startDate }).exec();

    expect(aggregateMockFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});
