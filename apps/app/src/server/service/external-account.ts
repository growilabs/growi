import { ErrorV3 } from '@growi/core/dist/models';

import { LoginErrorCode } from '~/interfaces/errors/login-error';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import loggerFactory from '~/utils/logger';

import { NullUsernameToBeRegisteredError } from '../models/errors';
import type { ExternalAccountDocument } from '../models/external-account';
import ExternalAccount from '../models/external-account';
import type PassportService from './passport';

const logger = loggerFactory('growi:service:external-account-service');

class ExternalAccountService {
  passportService: PassportService;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(passportService: PassportService) {
    this.passportService = passportService;
  }

  async getOrCreateUser(
    userInfo: { id: string; username: string; name?: string; email?: string },
    providerId: IExternalAuthProviderType,
  ): Promise<ExternalAccountDocument | undefined> {
    // get option
    const isSameUsernameTreatedAsIdenticalUser =
      this.passportService.isSameUsernameTreatedAsIdenticalUser(providerId);
    const isSameEmailTreatedAsIdenticalUser =
      providerId === 'ldap'
        ? false
        : this.passportService.isSameEmailTreatedAsIdenticalUser(providerId);

    try {
      // find or register(create) user
      const externalAccount = await ExternalAccount.findOrRegister(
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
          return ExternalAccount.associate(providerId, userInfo.id, err.user);
        }
        logger.error('provider-DuplicatedUsernameException', providerId);

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

// eslint-disable-next-line import/no-mutable-exports
export let externalAccountService: ExternalAccountService | undefined; // singleton instance
export default function instanciate(passportService: PassportService): void {
  externalAccountService = new ExternalAccountService(passportService);
}
