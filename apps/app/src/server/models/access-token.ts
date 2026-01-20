import type { IUserHasId, Ref, Scope } from '@growi/core/dist/interfaces';
import crypto from 'crypto';
import type { Document, HydratedDocument, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import loggerFactory from '~/utils/logger';

import { getOrCreateModel } from '../util/mongoose-utils';
import { extractScopes } from '../util/scope-utils';

const logger = loggerFactory('growi:models:access-token');

const generateTokenHash = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

type GenerateTokenResult = {
  token: string;
  _id: Types.ObjectId;
  expiredAt: Date;
  scopes?: Scope[];
  description?: string;
};

export type IAccessToken = {
  user: Ref<IUserHasId>;
  tokenHash: string;
  expiredAt: Date;
  scopes?: Scope[];
  description?: string;
};

export interface IAccessTokenDocument extends IAccessToken, Document {
  isExpired: () => boolean;
}

export interface IAccessTokenModel extends Model<IAccessTokenDocument> {
  generateToken: (
    userId: Types.ObjectId | string,
    expiredAt: Date,
    scopes?: Scope[],
    description?: string,
  ) => Promise<GenerateTokenResult>;
  deleteToken: (token: string) => Promise<void>;
  deleteTokenById: (tokenId: Types.ObjectId | string) => Promise<void>;
  deleteAllTokensByUserId: (userId: Types.ObjectId | string) => Promise<void>;
  deleteExpiredToken: () => Promise<void>;
  findUserIdByToken: (
    token: string,
    requiredScopes: Scope[],
  ) => Promise<HydratedDocument<IAccessTokenDocument> | null>;
  findTokenByUserId: (
    userId: Types.ObjectId | string,
  ) => Promise<HydratedDocument<IAccessTokenDocument>[] | null>;
  validateTokenScopes: (
    token: string,
    requiredScopes: Scope[],
  ) => Promise<boolean>;
}

const accessTokenSchema = new Schema<IAccessTokenDocument, IAccessTokenModel>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  tokenHash: { type: String, required: true, unique: true },
  expiredAt: { type: Date, required: true, index: true },
  scopes: [{ type: String, default: '' }],
  description: { type: String, default: '' },
});

accessTokenSchema.plugin(mongoosePaginate);
accessTokenSchema.plugin(uniqueValidator);

accessTokenSchema.statics.generateToken = async function (
  userId: Types.ObjectId | string,
  expiredAt: Date,
  scopes?: Scope[],
  description?: string,
) {
  const extractedScopes = extractScopes(scopes ?? []);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = generateTokenHash(token);

  try {
    const { _id } = await this.create({
      user: userId,
      tokenHash,
      expiredAt,
      scopes: extractedScopes,
      description,
    });

    logger.debug('Token generated');
    return {
      token,
      _id,
      expiredAt,
      scopes: extractedScopes,
      description,
    };
  } catch (err) {
    logger.debug('Failed to generate token');
    throw err;
  }
};

accessTokenSchema.statics.deleteToken = async function (token: string) {
  const tokenHash = generateTokenHash(token);
  await this.deleteOne({ tokenHash });
};

accessTokenSchema.statics.deleteTokenById = async function (
  tokenId: Types.ObjectId | string,
) {
  await this.deleteOne({ _id: tokenId });
};

accessTokenSchema.statics.deleteAllTokensByUserId = async function (
  userId: Types.ObjectId | string,
) {
  await this.deleteMany({ user: userId });
};

accessTokenSchema.statics.deleteExpiredToken = async function () {
  const now = new Date();
  await this.deleteMany({ expiredAt: { $lt: now } });
};

accessTokenSchema.statics.findUserIdByToken = async function (
  token: string,
  requiredScopes: Scope[],
) {
  const tokenHash = generateTokenHash(token);
  const now = new Date();
  if (requiredScopes.length === 0) {
    return;
  }
  const extractedScopes = extractScopes(requiredScopes);
  return this.findOne({
    tokenHash,
    expiredAt: { $gte: now },
    scopes: { $all: extractedScopes },
  }).select('user');
};

accessTokenSchema.statics.findTokenByUserId = async function (
  userId: Types.ObjectId | string,
) {
  const now = new Date();
  return this.find({ user: userId, expiredAt: { $gte: now } }).select(
    '_id expiredAt scopes description',
  );
};

accessTokenSchema.statics.validateTokenScopes = async function (
  token: string,
  requiredScopes: Scope[],
) {
  return this.findUserIdByToken(token, requiredScopes) != null;
};

accessTokenSchema.methods.isExpired = function () {
  return this.expiredAt < new Date();
};

export const AccessToken = getOrCreateModel<
  IAccessTokenDocument,
  IAccessTokenModel
>('AccessToken', accessTokenSchema);
