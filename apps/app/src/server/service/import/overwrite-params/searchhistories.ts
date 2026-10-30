import { Types } from 'mongoose';

import type { OverwriteParams } from '../import-settings';

const { ObjectId } = Types;

export const overwriteParams: OverwriteParams = {
  user: (value) => new ObjectId(value as string),
  // Pass through so the default conversion never turns an ISO-shaped keyword into a Date
  keyword: (value) => value,
};
