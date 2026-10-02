import { Types } from 'mongoose';

import { hasIntersection, includesObjectIds } from './compare-objectId';

describe('Objectid comparison utils', () => {
  const id1 = new Types.ObjectId();
  const id2 = new Types.ObjectId();
  const id3 = new Types.ObjectId();
  const id4 = new Types.ObjectId();

  describe('includesObjectIds', () => {
    describe('When subset of array given', () => {
      const arr = [id1, id2, id3, id4];
      const subset = [id1, id4];

      it('returns true', () => {
        expect(includesObjectIds(arr, subset)).toBe(true);
      });
    });

    describe('When set that intersects with array given', () => {
      const arr = [id1, id2, id3];
      const subset = [id1, id4];

      it('returns false', () => {
        expect(includesObjectIds(arr, subset)).toBe(false);
      });
    });
  });

  describe('hasIntersection', () => {
    describe('When arrays have intersection', () => {
      const arr1 = [id1, id2, id3, id4];
      const arr2 = [id1, id4];

      it('returns true', () => {
        expect(hasIntersection(arr1, arr2)).toBe(true);
      });
    });

    describe("When arrays don't have intersection", () => {
      const arr1 = [id1, id2];
      const arr2 = [id3, id4];

      it('returns false', () => {
        expect(hasIntersection(arr1, arr2)).toBe(false);
      });
    });
  });
});
