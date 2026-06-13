import { ErrorV3 } from '@growi/core/dist/models';

import { LoginErrorCode } from '~/interfaces/errors/login-error.js';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider.js';
import { NullUsernameToBeRegisteredError } from '~/server/models/errors.js';
import loggerFactory from '~/utils/logger/index.js';
import { prisma } from '~/utils/prisma.js';

import type PassportService from './passport.js';

const logger = loggerFactory('growi:service:external-account-service');

class ExternalAccountService {
  passportService: PassportService;

  constructor(passportService: PassportService) {
    this.passportService = passportService;
  }

  async getOrCreateUser(
    userInfo: { id: string; username: string; name?: string; email?: string },
    providerId: IExternalAuthProviderType,
  ) {
    // get option
    const isSameUsernameTreatedAsIdenticalUser =
      this.passportService.isSameUsernameTreatedAsIdenticalUser(providerId);
    const isSameEmailTreatedAsIdenticalUser =
      providerId === 'ldap'
        ? false
        : this.passportService.isSameEmailTreatedAsIdenticalUser(providerId);

    try {
      // find or register(create) user
      const externalAccount = await prisma.externalaccounts.findOrRegister(
        isSameUsernameTreatedAsIdenticalUser,
        isSameEmailTreatedAsIdenticalUser,
        providerId,
        userInfo.id,
        userInfo.username,
        userInfo.name,
        userInfo.email,
      );
      return externalAccount;
    } catch (err) {
      if (err instanceof NullUsernameToBeRegisteredError) {
        logger.error(err.message);
        throw new ErrorV3(err.message);
      } else if (err.name === 'DuplicatedUsernameException') {
        if (
          isSameEmailTreatedAsIdenticalUser ||
          isSameUsernameTreatedAsIdenticalUser
        ) {
          // associate to existing user
          logger.debug(
            `ExternalAccount '${userInfo.username}' will be created and bound to the exisiting User account`,
          );
          return prisma.externalaccounts.associate(
            providerId,
            userInfo.id,
            err.user,
          );
        }
        logger.error({ providerId }, 'provider-DuplicatedUsernameException');

        throw new ErrorV3(
          'message.provider_duplicated_username_exception',
          LoginErrorCode.PROVIDER_DUPLICATED_USERNAME_EXCEPTION,
          undefined,
          { failedProviderForDuplicatedUsernameException: providerId },
        );
      } else if (err.name === 'UserUpperLimitException') {
        logger.error(err.message);
        throw new ErrorV3(err.message);
      }
    }
  }
}

export let externalAccountService: ExternalAccountService | undefined; // singleton instance
export default function instanciate(passportService: PassportService): void {
  externalAccountService = new ExternalAccountService(passportService);
}
