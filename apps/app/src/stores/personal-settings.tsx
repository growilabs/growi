import { useCallback } from 'react';

import type { HasObjectId, IExternalAccount, IUser } from '@growi/core/dist/interfaces';
import { useTranslation } from 'next-i18next';
import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';

import type {
  IResGenerateAccessToken, IResGetAccessToken, IAccessTokenInfo,
} from '~/interfaces/access-token';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { useIsGuestUser } from '~/stores-universal/context';
import loggerFactory from '~/utils/logger';

import {
  apiv3Delete, apiv3Get, apiv3Put, apiv3Post,
} from '../client/util/apiv3-client';

import { useStaticSWR } from './use-static-swr';


const logger = loggerFactory('growi:stores:personal-settings');


export const useSWRxPersonalSettings = (config?: SWRConfiguration): SWRResponse<IUser, Error> => {
  const { data: isGuestUser } = useIsGuestUser();

  const key = !isGuestUser ? '/personal-setting' : null;

  return useSWR(
    key,
    endpoint => apiv3Get(endpoint).then(response => response.data.currentUser),
    config,
  );
};

export type IPersonalSettingsInfoOption = {
  sync: () => void,
  updateBasicInfo: () => Promise<void>,
  associateLdapAccount: (account: { username: string, password: string }) => Promise<void>,
  disassociateLdapAccount: (account: { providerType: IExternalAuthProviderType, accountId: string }) => Promise<void>,
}

export const usePersonalSettings = (config?: SWRConfiguration): SWRResponse<IUser, Error> & IPersonalSettingsInfoOption => {
  const { i18n } = useTranslation();
  const { data: personalSettingsDataFromDB, mutate: revalidate } = useSWRxPersonalSettings(config);
  const key = personalSettingsDataFromDB != null ? 'personalSettingsInfo' : null;

  const swrResult = useStaticSWR<IUser, Error>(key, undefined, { fallbackData: personalSettingsDataFromDB });

  // Sync with database
  const sync = async(): Promise<void> => {
    const { mutate } = swrResult;
    const result = await revalidate();
    mutate(result);
  };

  const updateBasicInfo = async(): Promise<void> => {
    const { data } = swrResult;

    if (data == null) {
      return;
    }

    const updateData = {
      name: data.name,
      email: data.email,
      isEmailPublished: data.isEmailPublished,
      lang: data.lang,
      slackMemberId: data.slackMemberId,
    };

    // invoke API
    try {
      await apiv3Put('/personal-setting/', updateData);
      i18n.changeLanguage(updateData.lang);
    }
    catch (errs) {
      logger.error(errs);
      throw errs;
    }
  };


  const associateLdapAccount = async(account): Promise<void> => {
    try {
      await apiv3Put('/personal-setting/associate-ldap', account);
    }
    catch (err) {
      logger.error(err);
      throw new Error('Failed to associate ldap account');
    }
  };

  const disassociateLdapAccount = async(account): Promise<void> => {
    try {
      await apiv3Put('/personal-setting/disassociate-ldap', account);
    }
    catch (err) {
      logger.error(err);
      throw new Error('Failed to disassociate ldap account');
    }
  };

  return {
    ...swrResult,
    sync,
    updateBasicInfo,
    associateLdapAccount,
    disassociateLdapAccount,
  };
};

export const useSWRxPersonalExternalAccounts = (): SWRResponse<(IExternalAccount<IExternalAuthProviderType> & HasObjectId)[], Error> => {
  return useSWR(
    '/personal-setting/external-accounts',
    endpoint => apiv3Get(endpoint).then(response => response.data.externalAccounts),
  );
};


interface IAccessTokenOption {
  generateAccessToken: (info: IAccessTokenInfo) => Promise<IResGenerateAccessToken>,
  deleteAccessToken: (tokenId: string) => Promise<void>,
  deleteAllAccessTokens: (userId: string) => Promise<void>,
}

export const useSWRxAccessToken = (): SWRResponse< IResGetAccessToken[] | null, Error> & IAccessTokenOption => {
  const generateAccessToken = useCallback(async(info) => {
    const res = await apiv3Post<IResGenerateAccessToken>('/personal-setting/access-token', info);
    return res.data;
  }, []);
  const deleteAccessToken = useCallback(async(tokenId: string) => {
    await apiv3Delete('/personal-setting/access-token', { tokenId });
  }, []);
  const deleteAllAccessTokens = useCallback(async() => {
    await apiv3Delete('/personal-setting/access-token/all');
  }, []);

  const swrResult = useSWR(
    '/personal-setting/access-token',
    endpoint => apiv3Get(endpoint).then(response => response.data.accessTokens),
  );

  return {
    ...swrResult,
    generateAccessToken,
    deleteAccessToken,
    deleteAllAccessTokens,
  };

};
