import React, { type JSX, useEffect } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { getIdForRef, type IPagePopulatedToShowRevision } from '@growi/core';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import superjson from 'superjson';

import { ShareLinkLayout } from '~/components/Layout/ShareLinkLayout';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import { ShareLinkPageView } from '~/components/ShareLinkPageView';
import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import { RegistrationMode } from '~/interfaces/registration-mode';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { IShareLinkHasId } from '~/interfaces/share-link';
import type { PageDocument, PageModel } from '~/server/models/page';
import ShareLink from '~/server/models/share-link';
import {
  useCurrentPageId,
  useIsNotFound,
  useSWRMUTxCurrentPage,
} from '~/stores/page';
import {
  useCurrentPathname,
  useCurrentUser,
  useIsContainerFluid,
  useIsEnabledMarp,
  useIsLocalAccountRegistrationEnabled,
  useIsSearchPage,
  useIsSearchScopeChildrenAsDefault,
  useIsSearchServiceConfigured,
  useIsSearchServiceReachable,
  useRendererConfig,
  useShareLinkId,
  useShowPageSideAuthors,
} from '~/stores-universal/context';
import loggerFactory from '~/utils/logger';

import type { NextPageWithLayout } from '../_app.page';
import type { CommonProps } from '../utils/commons';
import {
  addActivity,
  generateCustomTitleForPage,
  getNextI18NextConfig,
  getServerSideCommonProps,
  skipSSR,
} from '../utils/commons';

const GrowiContextualSubNavigationSubstance = dynamic(
  () => import('~/client/components/Navbar/GrowiContextualSubNavigation'),
  { ssr: false },
);

const logger = loggerFactory('growi:next-page:share');

type Props = CommonProps & {
  shareLinkRelatedPage?: IShareLinkRelatedPage;
  shareLink?: IShareLinkHasId;
  isNotFound: boolean;
  isExpired: boolean;
  disableLinkSharing: boolean;
  isSearchServiceConfigured: boolean;
  isSearchServiceReachable: boolean;
  isSearchScopeChildrenAsDefault: boolean;
  showPageSideAuthors: boolean;
  isEnabledMarp: boolean;
  isLocalAccountRegistrationEnabled: boolean;
  drawioUri: string | null;
  rendererConfig: RendererConfig;
  skipSSR: boolean;
  ssrMaxRevisionBodyLength: number;
};

type IShareLinkRelatedPage = IPagePopulatedToShowRevision & PageDocument;

superjson.registerCustom<IShareLinkRelatedPage, string>(
  {
    isApplicable: (v): v is IShareLinkRelatedPage => {
      return v != null && v.toObject != null;
    },
    serialize: (v) => {
      return superjson.stringify(v.toObject());
    },
    deserialize: (v) => {
      return superjson.parse(v);
    },
  },
  'IShareLinkRelatedPageTransformer',
);

// GrowiContextualSubNavigation for shared page
// get page info from props not to send request 'GET /page' from client
type GrowiContextualSubNavigationForSharedPageProps = {
  page?: IPagePopulatedToShowRevision;
  isLinkSharingDisabled: boolean;
};

const GrowiContextualSubNavigationForSharedPage = (
  props: GrowiContextualSubNavigationForSharedPageProps,
): JSX.Element => {
  const { page, isLinkSharingDisabled } = props;

  return (
    <GrowiContextualSubNavigationSubstance
      currentPage={page}
      isLinkSharingDisabled={isLinkSharingDisabled}
    />
  );
};

const SharedPage: NextPageWithLayout<Props> = (props: Props) => {
  useCurrentPathname(props.shareLink?.relatedPage.path);
  useIsSearchPage(false);
  useIsNotFound(props.isNotFound);
  useShareLinkId(props.shareLink?._id);
  useCurrentPageId(props.shareLink?.relatedPage._id);
  useCurrentUser(props.currentUser);
  useRendererConfig(props.rendererConfig);
  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);
  useIsEnabledMarp(props.rendererConfig.isEnabledMarp);
  useIsLocalAccountRegistrationEnabled(props.isLocalAccountRegistrationEnabled);
  useShowPageSideAuthors(props.showPageSideAuthors);
  useIsContainerFluid(props.isContainerFluid);

  const { trigger: mutateCurrentPage, data: currentPage } =
    useSWRMUTxCurrentPage();

  useEffect(() => {
    if (!props.skipSSR) {
      return;
    }

    if (props.shareLink?.relatedPage._id != null && !props.isNotFound) {
      mutateCurrentPage();
    }
  }, [
    mutateCurrentPage,
    props.isNotFound,
    props.shareLink?.relatedPage._id,
    props.skipSSR,
  ]);

  const pagePath = props.shareLinkRelatedPage?.path ?? '';

  const title = generateCustomTitleForPage(props, pagePath);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>

      <div className="dynamic-layout-root justify-content-between">
        <GrowiContextualSubNavigationForSharedPage
          page={currentPage ?? props.shareLinkRelatedPage}
          isLinkSharingDisabled={props.disableLinkSharing}
        />

        <ShareLinkPageView
          pagePath={pagePath}
          rendererConfig={props.rendererConfig}
          page={currentPage ?? props.shareLinkRelatedPage}
          shareLink={props.shareLink}
          isExpired={props.isExpired}
          disableLinkSharing={props.disableLinkSharing}
        />
      </div>
    </>
  );
};

SharedPage.getLayout = function getLayout(page) {
  return (
    <>
      <DrawioViewerScript drawioUri={page.props.rendererConfig.drawioUri} />
      <ShareLinkLayout>{page}</ShareLinkLayout>
    </>
  );
};

function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): void {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, searchService } = crowi;

  props.disableLinkSharing = configManager.getConfig(
    'security:disableLinkSharing',
  );

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig(
    'customize:isSearchScopeChildrenAsDefault',
  );

  props.drawioUri = configManager.getConfig('app:drawioUri');

  props.showPageSideAuthors = configManager.getConfig(
    'customize:showPageSideAuthors',
  );

  props.isLocalAccountRegistrationEnabled =
    crowi.passportService.isLocalStrategySetup &&
    configManager.getConfig('security:registrationMode') !==
      RegistrationMode.CLOSED;

  props.rendererConfig = {
    isSharedPage: true,
    isEnabledLinebreaks: configManager.getConfig(
      'markdown:isEnabledLinebreaks',
    ),
    isEnabledLinebreaksInComments: configManager.getConfig(
      'markdown:isEnabledLinebreaksInComments',
    ),
    isEnabledMarp: configManager.getConfig('customize:isEnabledMarp'),
    adminPreferredIndentSize: configManager.getConfig(
      'markdown:adminPreferredIndentSize',
    ),
    isIndentSizeForced: configManager.getConfig('markdown:isIndentSizeForced'),

    drawioUri: configManager.getConfig('app:drawioUri'),
    plantumlUri: configManager.getConfig('app:plantumlUri'),

    // XSS Options
    isEnabledXssPrevention: configManager.getConfig(
      'markdown:rehypeSanitize:isEnabledPrevention',
    ),
    sanitizeType: configManager.getConfig('markdown:rehypeSanitize:option'),
    customTagWhitelist: crowi.configManager.getConfig(
      'markdown:rehypeSanitize:tagNames',
    ),
    customAttrWhitelist:
      configManager.getConfig('markdown:rehypeSanitize:attributes') != null
        ? JSON.parse(
            configManager.getConfig('markdown:rehypeSanitize:attributes'),
          )
        : undefined,
    highlightJsStyleBorder: crowi.configManager.getConfig(
      'customize:highlightJsStyleBorder',
    ),
  };

  props.ssrMaxRevisionBodyLength = configManager.getConfig(
    'app:ssrMaxRevisionBodyLength',
  );
}

async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

function getAction(props: Props): SupportedActionType {
  let action: SupportedActionType;
  if (props.isExpired) {
    action = SupportedAction.ACTION_SHARE_LINK_EXPIRED_PAGE_VIEW;
  } else if (props.shareLink == null) {
    action = SupportedAction.ACTION_SHARE_LINK_NOT_FOUND;
  } else {
    action = SupportedAction.ACTION_SHARE_LINK_PAGE_VIEW;
  }

  return action;
}
export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req = context.req as CrowiRequest;
  const { crowi, params } = req;
  const result = await getServerSideCommonProps(context);

  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }
  const props: Props = result.props as Props;

  try {
    const shareLink = await ShareLink.findOne({ _id: params.linkId }).populate(
      'relatedPage',
    );
    if (shareLink == null) {
      props.isNotFound = true;
    } else {
      props.isNotFound = false;
      props.isExpired = shareLink.isExpired();
      props.shareLink = shareLink.toObject();

      // retrieve Page
      const Page = crowi.model('Page') as PageModel;
      const relatedPage = await Page.findOne({
        _id: getIdForRef(shareLink.relatedPage),
      });
      // determine whether skip SSR
      const ssrMaxRevisionBodyLength = crowi.configManager.getConfig(
        'app:ssrMaxRevisionBodyLength',
      );

      if (relatedPage != null) {
        props.skipSSR = await skipSSR(relatedPage, ssrMaxRevisionBodyLength);
        // populate
        props.shareLinkRelatedPage =
          await relatedPage.populateDataToShowRevision(props.skipSSR); // shouldExcludeBody = skipSSR
      }
    }
  } catch (err) {
    logger.error(err);
  }

  injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props);
  await addActivity(context, getAction(props));

  return {
    props,
  };
};

export default SharedPage;
