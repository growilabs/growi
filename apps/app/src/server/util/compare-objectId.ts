import mongoose from 'mongoose';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

type IObjectId = mongoose.Types.ObjectId;
const ObjectId = mongoose.Types.ObjectId;

/**
 * Check if array contains all specified ObjectIds
 * @param arr array that potentially contains potentialSubset
 * @param potentialSubset array that is potentially a subset of arr
 * @returns Whether or not arr includes all elements of potentialSubset
 */
export const includesObjectIds = (
  arr: ObjectIdLike[],
  potentialSubset: ObjectIdLike[],
): boolean => {
  const _arr = arr.map((i) => i.toString());
  const _potentialSubset = potentialSubset.map((i) => i.toString());

  return _potentialSubset.every((id) => _arr.includes(id));
};

/**
 * Check if 2 arrays have an intersection
 * @param arr1 an array with ObjectIds
 * @param arr2 another array with ObjectIds
 * @returns Whether or not arr1 and arr2 have an intersection
 */
export const hasIntersection = (
  arr1: ObjectIdLike[],
  arr2: ObjectIdLike[],
): boolean => {
  const _arr1 = arr1.map((i) => i.toString());
  const _arr2 = arr2.map((i) => i.toString());

  return _arr1.some((item) => _arr2.includes(item));
};

/**
 * Exclude ObjectIds which exist in testIds from targetIds
 * @param targetIds Array of mongoose.Types.ObjectId
 * @param testIds Array of mongoose.Types.ObjectId
 * @returns Array of mongoose.Types.ObjectId
 */
export const excludeTestIdsFromTargetIds = <
  T extends { toString: any } = IObjectId,
>(
  targetIds: T[],
  testIds: ObjectIdLike[],
): T[] => {
  // cast to string
  const arr1 = targetIds.map((e) => e.toString());
  const arr2 = testIds.map((e) => e.toString());

  // filter
  const excluded = arr1.filter((e) => !arr2.includes(e));
  // cast to ObjectId
  const shouldReturnString = (arr: any[]): arr is string[] => {
    return typeof arr[0] === 'string';
  };

  return shouldReturnString(targetIds)
    ? excluded
    : excluded.map((e) => new ObjectId(e));
};
