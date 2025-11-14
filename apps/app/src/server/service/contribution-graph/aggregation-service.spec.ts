import {
  vi, describe, beforeAll, beforeEach, it, expect,
} from 'vitest';


// Global reference for the mock function used in test assertions.
let aggregateMockFn: ReturnType<typeof vi.fn>;

vi.mock('~/server/models/activity', () => {
  const aggregateMock = vi.fn();

  // Assign the reference for use in the test suite assertions
  aggregateMockFn = aggregateMock;

  // Define the mock object structure that the service will import
  const ActivityMock = {
    aggregate: aggregateMock,
  };

  return {
    default: ActivityMock,
  };
});

vi.mock('~/interfaces/activity', () => {
  const MOCK_ACTIONS = {
    ACTION_PAGE_CREATED: 'PAGE_CREATE',
    ACTION_PAGE_UPDATED: 'PAGE_UPDATE',
  };

  return {
    ActivityLogActions: MOCK_ACTIONS,
  };
});


interface MockAggregate {
    exec: () => Promise<any>;
}

describe('ContributionAggregationService', { timeout: 15000 }, () => {
  let service: any;
  let aggregateMock: ReturnType<typeof vi.fn>;

  beforeAll(async() => {
    const { ContributionAggregationService } = await import('./aggregation-service');

    if (!aggregateMockFn) {
      throw new Error('Mongoose mock was not initialized correctly by vi.mock factory.');
    }
    aggregateMock = aggregateMockFn;

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

    aggregateMock.mockReturnValue(mockAggregate);

    const result = await service.runAggregationPipeline({ userId, startDate }).exec();

    expect(aggregateMock).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockDbOutput);
  });

  // Test Case 3: Ensures an empty array is returned when no results are found
  it('should return an empty array if no activities are found in the range', async() => {
    const userId = 'user_empty';
    const startDate = new Date('2025-11-15T00:00:00.000Z');

    const mockExec = vi.fn().mockResolvedValue([]);
    const mockAggregate: MockAggregate = { exec: mockExec };

    aggregateMock.mockReturnValue(mockAggregate);

    const result = await service.runAggregationPipeline({ userId, startDate }).exec();

    expect(aggregateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});
