import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import { AllLang } from '@growi/core';
import type { SSRConfig } from 'next-i18next';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { getLangAtServerSide } from '~/pages/utils/locale';

// Shared helper function to create i18n config with proper configuration
async function createNextI18NextConfig(
  context: GetServerSidePropsContext,
  namespacesRequired?: string[],
  preloadAllLang = false,
): Promise<SSRConfig> {
  const { serverSideTranslations } = await import(
    'next-i18next/serverSideTranslations'
  );

  // Import configuration to fix the error
  const nextI18NextConfig = await import('^/config/next-i18next.config');

  // Determine language from request context
  const req: CrowiRequest = context.req as CrowiRequest;
  const lang = getLangAtServerSide(req);

  // Prepare namespaces with commons as default
  const namespaces = ['commons'];
  if (namespacesRequired != null) {
    namespaces.push(...namespacesRequired);
  } else {
    // TODO: deprecate 'translation.json' in the future
    namespaces.push('translation');
  }

  // Call serverSideTranslations with proper configuration
  return serverSideTranslations(
    lang,
    namespaces,
    nextI18NextConfig,
    preloadAllLang ? AllLang : false,
  );
}

export type GetServerSideI18nPropsOption = {
  preloadAllLang: boolean;
};

export const getServerSideI18nProps = async (
  context: GetServerSidePropsContext,
  namespacesRequired?: string[] | undefined,
  options?: GetServerSideI18nPropsOption,
): Promise<GetServerSidePropsResult<SSRConfig>> => {
  // Use the shared helper function instead of the local one
  const nextI18NextConfig = await createNextI18NextConfig(
    context,
    namespacesRequired,
    options?.preloadAllLang,
  );

  return {
    props: {
      _nextI18Next: nextI18NextConfig._nextI18Next,
    },
  };
};
