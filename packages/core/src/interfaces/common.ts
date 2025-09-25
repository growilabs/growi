/*
 * Common types and interfaces
 */

import type { Types } from 'mongoose';

import { isValidObjectId } from '../utils/objectid-utils';

type ObjectId = Types.ObjectId;

// Foreign key field
export type Ref<T> = string | ObjectId | (T & { _id: string | ObjectId });

export type Nullable<T> = T | null | undefined;

export const isRef = <T>(obj: unknown): obj is Ref<T> => {
  return (
    obj != null &&
    ((typeof obj === 'string' && isValidObjectId(obj)) ||
      (typeof obj === 'object' &&
        '_bsontype' in obj &&
        obj._bsontype === 'ObjectID') ||
      (typeof obj === 'object' && '_id' in obj))
  );
};

export const isPopulated = <T>(
  ref: Ref<T>,
): ref is T & { _id: string | ObjectId } => {
  return (
    ref != null &&
    typeof ref !== 'string' &&
    !('_bsontype' in ref && ref._bsontype === 'ObjectID')
  );
};

export const getIdForRef = <T>(ref: Ref<T>): string | ObjectId => {
  return isPopulated(ref) ? ref._id : ref;
};

export const getIdStringForRef = <T>(ref: Ref<T>): string => {
  return getIdForRef(ref).toString();
};
