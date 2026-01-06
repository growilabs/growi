import {
  vi, describe, beforeAll, beforeEach, it, expect,
} from 'vitest';


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
    expect(match.action.$in).toHaveLength(2);
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


  it('should generate the pipeline and pass it directly to the Activity model', async() => {
  // 1. Arrange: Create a spy on the internal buildPipeline method
    const buildPipelineSpy = vi.spyOn(service, 'buildPipeline');

    const params = {
      userId: 'user_789',
      startDate: new Date('2026-01-01'),
    };

    // 2. Act
    service.runAggregationPipeline(params);

    // 3. Assert
    expect(buildPipelineSpy).toHaveBeenCalledWith(params);

    // Check that the output of buildPipeline was passed to Activity.aggregate
    const generatedPipeline = buildPipelineSpy.mock.results[0].value;
    expect(aggregateMockFn).toHaveBeenCalledWith(generatedPipeline);
  });

  it('should include all required activity actions in the match stage', () => {
    const pipeline = service.buildPipeline({ userId: '123', startDate: new Date() });
    const match = pipeline.find(s => '$match' in s)?.$match;

    expect(match.action.$in).toContain('PAGE_CREATE');
    expect(match.action.$in).toContain('PAGE_UPDATE');
  });

  it('should exclude activities from today by using a "less than" midnight boundary', () => {
    const startDate = new Date('2025-01-01');
    const pipeline = service.buildPipeline({ userId: '123', startDate });

    const match = pipeline.find(s => '$match' in s)?.$match;

    // Verify the operator is specifically $lt and not $lte
    expect(match.timestamp).toHaveProperty('$lt');
    expect(match.timestamp).not.toHaveProperty('$lte');

    // Verify the endDate is exactly midnight
    const endDate = match.timestamp.$lt;
    expect(endDate.getUTCHours()).toBe(0);
  });

  it('should use UTC (Z) for both grouping and date formatting', () => {
    const pipeline = service.buildPipeline({ userId: '123', startDate: new Date() });

    const group = pipeline.find(s => '$group' in s)?.$group;

    // This ensures the "Source of Truth" for the date is UTC
    expect(group._id.$dateToString.timezone).toBe('Z');
    expect(group._id.$dateToString.format).toBe('%Y-%m-%d');
  });
});
