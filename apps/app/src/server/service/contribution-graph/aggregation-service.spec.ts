import {
  vi, describe, beforeAll, beforeEach, it, expect,
} from 'vitest';

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


  // Test Case 1: Verifies the pipeline structure and parameterization
  it('should build a correctly structured 5-stage pipeline with dynamic parameters', () => {
    const userId = 'user_123';
    const startDate = new Date('2025-11-01T00:00:00.000Z');

    const pipeline = service.buildPipeline({ userId, startDate });

    const matchStage = (pipeline[0] as { $match: any }).$match;
    expect(matchStage.userId).toBe(userId);
    expect(matchStage.timestamp.$gte).toEqual(startDate);

    const expectedActions = ['PAGE_CREATE', 'PAGE_UPDATE'];
    expect(matchStage.action.$in).toEqual(expectedActions);
    expect(pipeline).toHaveLength(5);
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
