// disable no-return-await for model functions
/* eslint-disable no-return-await */
import type {
  IExternalAccount,
  IUser,
  IUserHasId,
} from '@growi/core/dist/interfaces';
import type { Document, HydratedDocument, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { NullUsernameToBeRegisteredError } from '~/server/models/errors';
import loggerFactory from '~/utils/logger';

import { getOrCreateModel } from '../util/mongoose-utils';

const logger = loggerFactory('growi:models:external-account');

export interface ExternalAccountDocument
  extends IExternalAccount<IExternalAuthProviderType>,
    Document {}

export interface ExternalAccountModel extends Model<ExternalAccountDocument> {
  [x: string]: any; // for old methods
}

const schema = new Schema<ExternalAccountDocument, ExternalAccountModel>(
  {
    providerType: { type: String, required: true },
    accountId: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
// compound index
schema.index({ providerType: 1, accountId: 1 }, { unique: true });
// apply plugins
schema.plugin(mongoosePaginate);
schema.plugin(uniqueValidator);

/**
 * limit items num for pagination
 */
const DEFAULT_LIMIT = 50;

/**
 * The Exception class thrown when User.username is duplicated when creating user
 *
 * @class DuplicatedUsernameException
 */
class DuplicatedUsernameException {
  name: string;

  message: string;

  user: IUserHasId;

  constructor(message, user) {
    this.name = this.constructor.name;
    this.message = message;
    this.user = user;
  }
}

/**
 * find an account or register if not found
 */
schema.statics.findOrRegister = function (
  isSameUsernameTreatedAsIdenticalUser: boolean,
  isSameEmailTreatedAsIdenticalUser: boolean,
  providerType: string,
  accountId: string,
  usernameToBeRegistered?: string,
  nameToBeRegistered?: string,
  mailToBeRegistered?: string,
): Promise<HydratedDocument<IExternalAccount<IExternalAuthProviderType>>> {
  return this.findOne({ providerType, accountId }).then((account) => {
    // ExternalAccount is found
    if (account != null) {
      logger.debug(`ExternalAccount '${accountId}' is found `, account);
      return account;
    }

    if (usernameToBeRegistered == null) {
      throw new NullUsernameToBeRegisteredError('username_should_not_be_null');
    }

    const User = mongoose.model<
      HydratedDocument<IUser>,
      Model<IUser> & { createUser; STATUS_ACTIVE }
    >('User');

    let promise = User.findOne({ username: usernameToBeRegistered }).exec();
    if (
      isSameUsernameTreatedAsIdenticalUser &&
      isSameEmailTreatedAsIdenticalUser
    ) {
      promise = promise.then((user) => {
        if (user == null) {
          return User.findOne({ email: mailToBeRegistered });
        }
        return user;
      });
    } else if (isSameEmailTreatedAsIdenticalUser) {
      promise = User.findOne({ email: mailToBeRegistered }).exec();
    }

    return promise
      .then((user) => {
        // when the User that have the same `username` exists
        if (user != null) {
          throw new DuplicatedUsernameException(
            `User '${usernameToBeRegistered}' already exists`,
            user,
          );
        }
        if (nameToBeRegistered == null) {
          // eslint-disable-next-line no-param-reassign
          nameToBeRegistered = '';
        }

        // create a new User with STATUS_ACTIVE
        logger.debug(
          `ExternalAccount '${accountId}' is not found, it is going to be registered.`,
        );
        return User.createUser(
          nameToBeRegistered,
          usernameToBeRegistered,
          mailToBeRegistered,
          undefined,
          undefined,
          User.STATUS_ACTIVE,
        );
      })
      .then((newUser) => {
        return this.associate(providerType, accountId, newUser);
      });
  });
};

/**
 * Create ExternalAccount document and associate to existing User
 */
schema.statics.associate = function (
  providerType: string,
  accountId: string,
  user: IUserHasId,
) {
  return this.create({ providerType, accountId, user: user._id });
};

/**
 * find all entities with pagination
 *
 * @see https://github.com/edwardhotchkiss/mongoose-paginate
 *
 * @static
 * @param {any} opts mongoose-paginate options object
 * @returns {Promise<any>} mongoose-paginate result object
 * @memberof ExternalAccount
 */
schema.statics.findAllWithPagination = function (opts) {
  const query = {};
  const options = Object.assign({ populate: 'user' }, opts);
  if (options.sort == null) {
    options.sort = { accountId: 1, createdAt: 1 };
  }
  if (options.limit == null) {
    options.limit = DEFAULT_LIMIT;
  }

  return this.paginate(query, options);
};

export default getOrCreateModel<ExternalAccountDocument, ExternalAccountModel>(
  'ExternalAccount',
  schema,
);
