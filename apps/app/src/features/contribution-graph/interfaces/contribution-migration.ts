import type { Types } from 'mongoose';

export interface IMigratableUser {
  _id: Types.ObjectId | string;
  contributionsMigratedAt?: Date | null;
}
