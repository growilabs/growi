import { useCallback } from 'react';
import type {
  HasObjectId,
  IExternalAccount,
  IUser,
} from '@growi/core/dist/interfaces';
import { useTranslation } from 'next-i18next';
import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

import type {
  IAccessTokenInfo,
  IResGenerateAccessToken,
  IResGetAccessToken,
} from '~/interfaces/access-token';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { useIsGuestUser } from '~/states/context';

import {
  apiv3Delete,
  apiv3Get,
  apiv3Post,
  apiv3Put,
} from '../client/util/apiv3-client';

export const useSWRxPersonalSettings = (
  config?: SWRConfiguration,
): SWRResponse<IUser, Error> => {
  const isGuestUser = useIsGuestUser();

  const key = !isGuestUser ? '/personal-setting' : null;

  return useSWR(
    key,
    (endpoint) =>
      apiv3Get(endpoint).then((response) => response.data.currentUser),
    config,
  );
};

/**
 * Hook for updating basic user information using SWR Mutation
 * This hook returns a trigger function that updates the user's basic info
 * and automatically updates the SWR cache after successful mutation.
 */
export const useUpdateBasicInfo = () => {
  const { i18n } = useTranslation();

  return useSWRMutation(
    '/personal-setting',
    async (_key, { arg }: { arg: IUser }) => {
      const updateData = {
        name: arg.name,
        email: arg.email,
        isEmailPublished: arg.isEmailPublished,
        lang: arg.lang,
        slackMemberId: arg.slackMemberId,
      };

      const response = await apiv3Put<{ currentUser: IUser }>(
        '/personal-setting/',
        updateData,
      );
      i18n.changeLanguage(updateData.lang);
      return response.data.currentUser;
    },
    {
      populateCache: true, // Update SWR cache with the result
      revalidate: false, // No need to revalidate since we're populating the cache
    },
  );
};

/**
 * Hook for associating LDAP account using SWR Mutation
 */
export const useAssociateLdapAccount = () => {
  return useSWRMutation(
    '/personal-setting',
    async (_key, { arg }: { arg: { username: string; password: string } }) => {
      const response = await apiv3Put<{ currentUser: IUser }>(
        '/personal-setting/associate-ldap',
        arg,
      );
      return response.data.currentUser;
    },
    {
      populateCache: true,
      revalidate: false,
    },
  );
};

/**
 * Hook for disassociating LDAP account using SWR Mutation
 */
export const useDisassociateLdapAccount = () => {
  return useSWRMutation(
    '/personal-setting',
    async (
      _key,
      {
        arg,
      }: {
        arg: { providerType: IExternalAuthProviderType; accountId: string };
      },
    ) => {
      const response = await apiv3Put<{ currentUser: IUser }>(
        '/personal-setting/disassociate-ldap',
        arg,
      );
      return response.data.currentUser;
    },
    {
      populateCache: true,
      revalidate: false,
    },
  );
};

export const useSWRxPersonalExternalAccounts = (): SWRResponse<
  (IExternalAccount<IExternalAuthProviderType> & HasObjectId)[],
  Error
> => {
  return useSWR('/personal-setting/external-accounts', (endpoint) =>
    apiv3Get(endpoint).then((response) => response.data.externalAccounts),
  );
};

interface IAccessTokenOption {
  generateAccessToken: (
    info: IAccessTokenInfo,
  ) => Promise<IResGenerateAccessToken>;
  deleteAccessToken: (tokenId: string) => Promise<void>;
  deleteAllAccessTokens: (userId: string) => Promise<void>;
}

export const useSWRxAccessToken = (): SWRResponse<
  IResGetAccessToken[] | null,
  Error
> &
  IAccessTokenOption => {
  const generateAccessToken = useCallback(async (info) => {
    const res = await apiv3Post<IResGenerateAccessToken>(
      '/personal-setting/access-token',
      info,
    );
    return res.data;
  }, []);
  const deleteAccessToken = useCallback(async (tokenId: string) => {
    await apiv3Delete('/personal-setting/access-token', { tokenId });
  }, []);
  const deleteAllAccessTokens = useCallback(async () => {
    await apiv3Delete('/personal-setting/access-token/all');
  }, []);

  const swrResult = useSWR('/personal-setting/access-token', (endpoint) =>
    apiv3Get(endpoint).then((response) => response.data.accessTokens),
  );

  return {
    ...swrResult,
    generateAccessToken,
    deleteAccessToken,
    deleteAllAccessTokens,
  };
};
