import type { IUser, IUserHasId } from '@growi/core/dist/interfaces';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { NullUsernameToBeRegisteredError } from '~/server/models/errors';
import { getOrCreateModel } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import { UserStatus } from './user/conts';

const logger = loggerFactory('growi:models:external-account');

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const schema = new Schema({
  providerType: { type: String, required: true },
  accountId: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});
schema.index({ providerType: 1, accountId: 1 }, { unique: true });
getOrCreateModel('ExternalAccount', schema);

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

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      externalaccounts: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      externalaccounts: {
        /**
         * find an account or register if not found
         */
        async findOrRegister(
          isSameUsernameTreatedAsIdenticalUser: boolean,
          isSameEmailTreatedAsIdenticalUser: boolean,
          providerType: string,
          accountId: string,
          usernameToBeRegistered: string | undefined,
          nameToBeRegistered = '',
          mailToBeRegistered?: string,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.externalaccounts>(this);

          const account = await context.findUnique({
            where: {
              providerType_accountId: {
                providerType,
                accountId,
              },
            },
          });

          if (account != null) {
            logger.debug(
              { account },
              `ExternalAccount '${accountId}' is found`,
            );
            return account;
          }

          if (usernameToBeRegistered == null) {
            throw new NullUsernameToBeRegisteredError(
              'username_should_not_be_null',
            );
          }

          const User = mongoose.model<
            HydratedDocument<IUser>,
            Model<IUser> & { createUser; STATUS_ACTIVE }
          >('User');

          let promise = User.findOne({
            username: usernameToBeRegistered,
          }).exec();
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
                UserStatus.STATUS_ACTIVE,
              );
            })
            .then((newUser) => {
              return context.associate(providerType, accountId, newUser);
            });
        },

        /**
         * Create ExternalAccount document and associate to existing User
         */
        associate(providerType: string, accountId: string, user: IUserHasId) {
          const context =
            Prisma.getExtensionContext<typeof prisma.externalaccounts>(this);
          return context.create({
            data: {
              providerType,
              accountId,
              userId: user._id,
            },
          });
        },

        /**
         * find all entities with pagination
         *
         * @param opts pagination options object
         * @returns external account objects
         */
        async findAllWithPagination({
          offset = 0,
          limit = DEFAULT_LIMIT,
          sort = [{ accountId: 'asc' }, { createdAt: 'asc' }],
        }: {
          offset?: number;
          limit?: number;
          sort?: Prisma.externalaccountsOrderByWithRelationInput[];
        } = {}) {
          const context =
            Prisma.getExtensionContext<typeof prisma.externalaccounts>(this);
          const result = await context.paginate({
            offset,
            limit,
            orderBy: sort,
            include: {
              user: true,
            },
          });

          return result;
        },
      },
    },
  });
});
