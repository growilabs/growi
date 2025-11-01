import crypto from 'crypto';
import { addHours } from 'date-fns/addHours';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IUserRegistrationOrder {
  token: string;
  email: string;
  isRevoked: boolean;
  createdAt: Date;
  expiredAt: Date;
}

export interface UserRegistrationOrderDocument
  extends IUserRegistrationOrder,
    Document {
  isExpired(): boolean;
  revokeOneTimeToken(): Promise<void>;
}

export interface UserRegistrationOrderModel
  extends Model<UserRegistrationOrderDocument> {
  generateOneTimeToken(): string;
  createUserRegistrationOrder(email: string): UserRegistrationOrderDocument;
}

const expiredAt = (): Date => {
  return addHours(new Date(), 1);
};

const schema = new Schema<
  UserRegistrationOrderDocument,
  UserRegistrationOrderModel
>(
  {
    token: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    isRevoked: { type: Boolean, default: false, required: true },
    expiredAt: { type: Date, default: expiredAt, required: true },
  },
  {
    timestamps: true,
  },
);
schema.plugin(uniqueValidator);

schema.statics.generateOneTimeToken = () => {
  const buf = crypto.randomBytes(256);
  const token = buf.toString('hex');

  return token;
};

schema.statics.createUserRegistrationOrder = async function (email) {
  let token: string;
  let duplicateToken: UserRegistrationOrderDocument | null = null;

  do {
    token = this.generateOneTimeToken();
    // eslint-disable-next-line no-await-in-loop
    duplicateToken = await this.findOne({ token });
  } while (duplicateToken != null);

  const userRegistrationOrderData = await this.create({ token, email });

  return userRegistrationOrderData;
};

schema.methods.isExpired = function () {
  return this.expiredAt.getTime() < Date.now();
};

schema.methods.revokeOneTimeToken = async function () {
  this.isRevoked = true;
  return this.save();
};

export default getOrCreateModel<
  UserRegistrationOrderDocument,
  UserRegistrationOrderModel
>('UserRegistrationOrder', schema);
