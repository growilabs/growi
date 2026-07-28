/**
 * Unit tests for buildPipeline's pipeline-shape contract.
 *
 * Regression: `user` was previously matched with a raw `mongoose.Types.ObjectId`
 * instance, which serializes to a plain JSON string when sent through
 * `aggregateRaw` -- that does NOT match a stored ObjectId-typed field, so the
 * pipeline silently matched zero documents (verified against a real MongoDB
 * replica set). `user` must be wrapped via `toRawObjectId` (the MongoDB
 * Extended JSON `$oid` form) instead.
 */
import { buildPipeline } from './activity-aggregation-service';

describe('buildPipeline', () => {
  it('matches `user` with the $oid Extended JSON form, not a raw ObjectId/string', () => {
    const userId = '507f1f77bcf86cd799439011';
    const startDate = new Date('2025-01-01T00:00:00Z');
    const endDate = new Date('2025-01-31T00:00:00Z');

    const pipeline = buildPipeline({ userId, startDate, endDate });

    const matchStage = pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match.user).toEqual({ $oid: userId });
  });

  it('filters by createdAt range with the $date Extended JSON form, not raw Date instances', () => {
    // Regression: a raw Date instance in an aggregateRaw $match range
    // comparison serializes to a plain JSON string, which does NOT compare
    // correctly against a stored BSON Date field -- the query silently
    // matched zero documents (verified against a real MongoDB replica set).
    const userId = '507f1f77bcf86cd799439011';
    const startDate = new Date('2025-01-01T00:00:00Z');
    const endDate = new Date('2025-01-31T00:00:00Z');

    const pipeline = buildPipeline({ userId, startDate, endDate });

    const matchStage = pipeline[0] as {
      $match: {
        createdAt: { $gte: { $date: string }; $lte: { $date: string } };
        action: unknown;
      };
    };
    expect(matchStage.$match.createdAt).toEqual({
      $gte: { $date: startDate.toISOString() },
      $lte: { $date: endDate.toISOString() },
    });
    expect(matchStage.$match.action).toBeDefined();
  });

  it('groups by day via $dateTrunc and projects date/count', () => {
    const pipeline = buildPipeline({
      userId: '507f1f77bcf86cd799439011',
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: new Date('2025-01-31T00:00:00Z'),
    });

    expect(pipeline[1]).toEqual({
      $group: {
        _id: {
          $dateTrunc: { date: '$createdAt', unit: 'day', timezone: 'UTC' },
        },
        count: { $sum: 1 },
      },
    });
    expect(pipeline[2]).toEqual({
      $project: {
        _id: 0,
        date: { $dateToString: { format: '%Y-%m-%d', date: '$_id' } },
        count: '$count',
      },
    });
    expect(pipeline[3]).toEqual({ $sort: { date: 1 } });
  });
});
