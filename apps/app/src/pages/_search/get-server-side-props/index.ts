import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import {
  isPermalink,
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getServerSideBasicLayoutProps } from '../../basic-layout-page';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../common-props';
import { getServerSideRendererConfigProps } from '../../general-page';
import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import type { ServerConfigurationProps } from '../types';

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  return {
    props: {
      serverConfig: {
        isContainerFluid: configManager.getConfig('customize:isContainerFluid'),
        showPageLimitationL: configManager.getConfig(
          'customize:showPageLimitationL',
        ),
      },
    },
  };
};

export const getServerSideSearchPageProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req: CrowiRequest = context.req as CrowiRequest;

  // redirect to the page the user was on before moving to the Login Page
  if (req.headers.referer != null) {
    const urlBeforeLogin = new URL(req.headers.referer);
    if (
      isPermalink(urlBeforeLogin.pathname) ||
      isUserPage(urlBeforeLogin.pathname) ||
      isUsersTopPage(urlBeforeLogin.pathname)
    ) {
      req.session.redirectTo = urlBeforeLogin.href;
    }
  }

  const [
    commonInitialResult,
    commonEachResult,
    basicLayoutResult,
    rendererConfigResult,
    serverConfigResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideRendererConfigProps(context),
    getServerSideConfigurationProps(context),
    getServerSideI18nProps(context, ['translation']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(
        basicLayoutResult,
        mergeGetServerSidePropsResults(
          rendererConfigResult,
          mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
        ),
      ),
    ),
  );
};
