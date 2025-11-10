import crypto from 'crypto';
import { addMinutes } from 'date-fns/addMinutes';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IPasswordResetOrder {
  token: string;
  email: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  relatedUser: any;
  isRevoked: boolean;
  createdAt: Date;
  expiredAt: Date;
}

export interface PasswordResetOrderDocument
  extends IPasswordResetOrder,
    Document {
  isExpired(): boolean;
  revokeOneTimeToken(): Promise<void>;
}

export interface PasswordResetOrderModel
  extends Model<PasswordResetOrderDocument> {
  generateOneTimeToken(): string;
  createPasswordResetOrder(email: string): PasswordResetOrderDocument;
}

const expiredAt = (): Date => {
  return addMinutes(new Date(), 10);
};

const schema = new Schema<PasswordResetOrderDocument, PasswordResetOrderModel>(
  {
    token: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    relatedUser: { type: Schema.Types.ObjectId, ref: 'User' },
    isRevoked: { type: Boolean, default: false, required: true },
    expiredAt: { type: Date, default: expiredAt, required: true },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
);
schema.plugin(uniqueValidator);

schema.statics.generateOneTimeToken = () => {
  const buf = crypto.randomBytes(256);
  const token = buf.toString('hex');

  return token;
};

schema.statics.createPasswordResetOrder = async function (email) {
  let token: string;
  let duplicateToken: PasswordResetOrderDocument | null = null;

  do {
    token = this.generateOneTimeToken();
    // eslint-disable-next-line no-await-in-loop
    duplicateToken = await this.findOne({ token });
  } while (duplicateToken != null);

  const passwordResetOrderData = await this.create({ token, email });

  return passwordResetOrderData;
};

schema.methods.isExpired = function () {
  return this.expiredAt.getTime() < Date.now();
};

schema.methods.revokeOneTimeToken = async function () {
  this.isRevoked = true;
  return this.save();
};

export default getOrCreateModel<
  PasswordResetOrderDocument,
  PasswordResetOrderModel
>('PasswordResetOrder', schema);
