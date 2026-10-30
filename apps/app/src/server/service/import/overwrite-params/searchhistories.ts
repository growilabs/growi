import { Types } from 'mongoose';

import type { OverwriteParams } from '../import-settings';

const { ObjectId } = Types;

export const overwriteParams: OverwriteParams = {
  user: (value) => new ObjectId(value as string),
};
