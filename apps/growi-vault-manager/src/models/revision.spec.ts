import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Unit tests for RevisionModel static methods ----
// These tests do NOT connect to MongoDB; they test the static method logic
// by mocking the underlying Mongoose model's `find` method.

import { RevisionModel } from './revision';

describe('RevisionModel.bodyQueryByIds', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { query, skippedIds } shape', () => {
    const mockQuery = {};
    const findSpy = vi
      .spyOn(RevisionModel, 'find')
      .mockReturnValue(mockQuery as never);

    const validId = new mongoose.Types.ObjectId().toHexString();
    const result = RevisionModel.bodyQueryByIds([validId]);

    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('skippedIds');
    findSpy.mockRestore();
  });

  it('filters out empty string and non-ObjectId IDs, puts them in skippedIds', () => {
    const mockQuery = {};
    const findSpy = vi
      .spyOn(RevisionModel, 'find')
      .mockReturnValue(mockQuery as never);

    const validId = new mongoose.Types.ObjectId().toHexString();
    const result = RevisionModel.bodyQueryByIds(['', 'not-an-oid', validId]);

    // Invalid IDs should be skipped
    expect(result.skippedIds).toEqual(['', 'not-an-oid']);
    // find should only be called with the valid ObjectId
    expect(findSpy).toHaveBeenCalledWith(
      { _id: { $in: [validId] } },
      { body: 1 },
    );
    findSpy.mockRestore();
  });

  it('handles empty array without throwing', () => {
    const mockQuery = {};
    const findSpy = vi
      .spyOn(RevisionModel, 'find')
      .mockReturnValue(mockQuery as never);

    expect(() => RevisionModel.bodyQueryByIds([])).not.toThrow();
    const result = RevisionModel.bodyQueryByIds([]);
    expect(result.skippedIds).toEqual([]);
    expect(findSpy).toHaveBeenCalledWith({ _id: { $in: [] } }, { body: 1 });
    findSpy.mockRestore();
  });

  it('passes all IDs when all are valid ObjectIds', () => {
    const mockQuery = {};
    const findSpy = vi
      .spyOn(RevisionModel, 'find')
      .mockReturnValue(mockQuery as never);

    const id1 = new mongoose.Types.ObjectId().toHexString();
    const id2 = new mongoose.Types.ObjectId().toHexString();
    const result = RevisionModel.bodyQueryByIds([id1, id2]);

    expect(result.skippedIds).toEqual([]);
    expect(findSpy).toHaveBeenCalledWith(
      { _id: { $in: [id1, id2] } },
      { body: 1 },
    );
    findSpy.mockRestore();
  });
});
