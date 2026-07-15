/**
 * Unit tests for buildUserActivityPipeline's pipeline-shape contract.
 *
 * Regression: `user` was previously matched with a raw `mongoose.Types.ObjectId`
 * instance, which serializes to a plain JSON string when sent through
 * `aggregateRaw` -- that does NOT match a stored ObjectId-typed field, so
 * `GET /api/v3/user-activities` silently returned zero results for every
 * user (verified against a real MongoDB replica set). `user` must be
 * wrapped via `toRawObjectId` (the MongoDB Extended JSON `$oid` form)
 * instead.
 */
import { buildUserActivityPipeline } from './user-activities';

describe('buildUserActivityPipeline', () => {
  const targetUserId = '507f1f77bcf86cd799439011';

  it('matches `user` with the $oid Extended JSON form, not a raw ObjectId/string', () => {
    const pipeline = buildUserActivityPipeline(targetUserId, {
      limit: 10,
      offset: 0,
    });

    const matchStage = pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match.user).toEqual({ $oid: targetUserId });
  });

  it('applies the requested limit/offset inside the docs facet', () => {
    const pipeline = buildUserActivityPipeline(targetUserId, {
      limit: 5,
      offset: 15,
    });

    const facetStage = pipeline[1] as {
      $facet: { docs: Record<string, unknown>[] };
    };
    expect(facetStage.$facet.docs).toContainEqual({ $skip: 15 });
    expect(facetStage.$facet.docs).toContainEqual({ $limit: 5 });
  });

  it('produces a totalCount facet via $count', () => {
    const pipeline = buildUserActivityPipeline(targetUserId, {
      limit: 10,
      offset: 0,
    });

    const facetStage = pipeline[1] as {
      $facet: { totalCount: Record<string, unknown>[] };
    };
    expect(facetStage.$facet.totalCount).toEqual([{ $count: 'count' }]);
  });
});
