import type { ReactNode, JSX } from 'react';
import React, { useEffect } from 'react';

import EventEmitter from 'events';

import { isIPageInfo } from '@growi/core';
import type {
  IDataWithMeta, IPageInfo, IPagePopulatedToShowRevision,
} from '@growi/core';
import {
  isClient, pagePathUtils, pathUtils,
} from '@growi/core/dist/utils';
import ExtensibleCustomError from 'extensible-custom-error';
import type {
  GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import superjson from 'superjson';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { PageView } from '~/components/PageView/PageView';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import { SupportedAction, type SupportedActionType } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import { RegistrationMode } from '~/interfaces/registration-mode';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import type { CurrentPageYjsData } from '~/interfaces/yjs';
import type { PageModel, PageDocument } from '~/server/models/page';
import type { PageRedirectModel } from '~/server/models/page-redirect';
import { useEditorModeClassName } from '~/services/layout/use-editor-mode-class-name';
import {
  useCurrentUser,
  useIsForbidden, useIsSharedUser,
  useIsEnabledStaleNotification, useIsIdenticalPath,
  useIsSearchServiceConfigured, useIsSearchServiceReachable, useDisableLinkSharing,
  useDefaultIndentSize, useIsIndentSizeForced,
  useIsAclEnabled, useIsSearchPage, useIsEnabledAttachTitleHeader,
  useCsrfToken, useIsSearchScopeChildrenAsDefault, useIsEnabledMarp, useCurrentPathname,
  useIsSlackConfigured, useRendererConfig, useGrowiCloudUri,
  useIsAllReplyShown, useShowPageSideAuthors, useIsContainerFluid, useIsNotCreatable,
  useIsUploadAllFileAllowed, useIsUploadEnabled, useIsBulkExportPagesEnabled,
  useElasticsearchMaxBodyLengthToIndex,
  useIsLocalAccountRegistrationEnabled,
  useIsRomUserAllowedToComment,
  useIsPdfBulkExportEnabled,
  useIsAiEnabled, useLimitLearnablePageCountPerAssistant, useIsUsersHomepageDeletionEnabled,
} from '~/stores-universal/context';
import { useEditingMarkdown } from '~/stores/editor';
import {
  useSWRxCurrentPage, useSWRMUTxCurrentPage, useCurrentPageId,
  useIsNotFound, useIsLatestRevision, useTemplateTagData, useTemplateBodyData,
} from '~/stores/page';
import { useRedirectFrom } from '~/stores/page-redirect';
import { useRemoteRevisionId } from '~/stores/remote-latest-page';
import { useSetupGlobalSocket, useSetupGlobalSocketForPage } from '~/stores/websocket';
import { useCurrentPageYjsData, useSWRMUTxCurrentPageYjsData } from '~/stores/yjs';
import loggerFactory from '~/utils/logger';

import type { NextPageWithLayout } from './_app.page';
import type { CommonProps } from './utils/commons';
import {
  getNextI18NextConfig, getServerSideCommonProps, generateCustomTitleForPage, useInitSidebarConfig, skipSSR, addActivity,
} from './utils/commons';


declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}


const GrowiContextualSubNavigationSubstance = dynamic(() => import('~/client/components/Navbar/GrowiContextualSubNavigation'), { ssr: false });

const GrowiPluginsActivator = dynamic(() => import('~/features/growi-plugin/client/components').then(mod => mod.GrowiPluginsActivator), { ssr: false });

const DisplaySwitcher = dynamic(() => import('~/client/components/Page/DisplaySwitcher').then(mod => mod.DisplaySwitcher), { ssr: false });
const PageStatusAlert = dynamic(() => import('~/client/components/PageStatusAlert').then(mod => mod.PageStatusAlert), { ssr: false });

const UnsavedAlertDialog = dynamic(() => import('~/client/components/UnsavedAlertDialog'), { ssr: false });
const DescendantsPageListModal = dynamic(
  () => import('~/client/components/DescendantsPageListModal').then(mod => mod.DescendantsPageListModal),
  { ssr: false },
);
const DrawioModal = dynamic(() => import('~/client/components/PageEditor/DrawioModal').then(mod => mod.DrawioModal), { ssr: false });
const HandsontableModal = dynamic(() => import('~/client/components/PageEditor/HandsontableModal').then(mod => mod.HandsontableModal), { ssr: false });
const TemplateModal = dynamic(() => import('~/client/components/TemplateModal').then(mod => mod.TemplateModal), { ssr: false });
const LinkEditModal = dynamic(() => import('~/client/components/PageEditor/LinkEditModal').then(mod => mod.LinkEditModal), { ssr: false });
const TagEditModal = dynamic(() => import('~/client/components/PageTags/TagEditModal').then(mod => mod.TagEditModal), { ssr: false });
const ConflictDiffModal = dynamic(() => import('~/client/components/PageEditor/ConflictDiffModal').then(mod => mod.ConflictDiffModal), { ssr: false });

const EditablePageEffects = dynamic(() => import('~/client/components/Page/EditablePageEffects').then(mod => mod.EditablePageEffects), { ssr: false });


const logger = loggerFactory('growi:pages:all');

const {
  isPermalink: _isPermalink, isCreatablePage,
} = pagePathUtils;
const { removeHeadingSlash } = pathUtils;

type IPageToShowRevisionWithMeta = IDataWithMeta<IPagePopulatedToShowRevision & PageDocument, IPageInfo>;
type IPageToShowRevisionWithMetaSerialized = IDataWithMeta<string, string>;

superjson.registerCustom<IPageToShowRevisionWithMeta, IPageToShowRevisionWithMetaSerialized>(
  {
    isApplicable: (v): v is IPageToShowRevisionWithMeta => {
      return v?.data != null
        && v?.data.toObject != null
        && isIPageInfo(v.meta);
    },
    serialize: (v) => {
      return {
        data: superjson.stringify(v.data.toObject()),
        meta: superjson.stringify(v.meta),
      };
    },
    deserialize: (v) => {
      return {
        data: superjson.parse(v.data),
        meta: v.meta != null ? superjson.parse(v.meta) : undefined,
      };
    },
  },
  'IPageToShowRevisionWithMetaTransformer',
);

// GrowiContextualSubNavigation for NOT shared page
type GrowiContextualSubNavigationProps = {
  isLinkSharingDisabled: boolean,
}

const GrowiContextualSubNavigation = (props: GrowiContextualSubNavigationProps): JSX.Element => {
  const { isLinkSharingDisabled } = props;
  const { data: currentPage } = useSWRxCurrentPage();
  return (
    <GrowiContextualSubNavigationSubstance currentPage={currentPage} isLinkSharingDisabled={isLinkSharingDisabled} />
  );
};

type Props = CommonProps & {
  pageWithMeta: IPageToShowRevisionWithMeta | null,
  // pageUser?: any,
  redirectFrom?: string;

  // shareLinkId?: string;
  isLatestRevision?: boolean,

  isIdenticalPathPage?: boolean,
  isForbidden: boolean,
  isNotFound: boolean,
  isNotCreatable: boolean,
  // isAbleToDeleteCompletely: boolean,

  templateTagData?: string[],
  templateBodyData?: string,

  isLocalAccountRegistrationEnabled: boolean,

  isSearchServiceConfigured: boolean,
  isSearchServiceReachable: boolean,
  isSearchScopeChildrenAsDefault: boolean,
  elasticsearchMaxBodyLengthToIndex: number,
  isEnabledMarp: boolean,

  isRomUserAllowedToComment: boolean,

  sidebarConfig: ISidebarConfig,

  isSlackConfigured: boolean,
  // isMailerSetup: boolean,
  isAclEnabled: boolean,
  // hasSlackConfig: boolean,
  drawioUri: string | null,
  // highlightJsStyle: string,
  isAllReplyShown: boolean,
  showPageSideAuthors: boolean,
  isContainerFluid: boolean,
  isUploadEnabled: boolean,
  isUploadAllFileAllowed: boolean,
  isBulkExportPagesEnabled: boolean,
  isPdfBulkExportEnabled: boolean,
  isEnabledStaleNotification: boolean,
  isEnabledAttachTitleHeader: boolean,
  // isEnabledLinebreaks: boolean,
  // isEnabledLinebreaksInComments: boolean,
  adminPreferredIndentSize: number,
  isIndentSizeForced: boolean,
  disableLinkSharing: boolean,
  skipSSR: boolean,
  ssrMaxRevisionBodyLength: number,

  yjsData: CurrentPageYjsData,

  rendererConfig: RendererConfig,

  aiEnabled: boolean,
  limitLearnablePageCountPerAssistant: number,
  isUsersHomepageDeletionEnabled: boolean,
};

const Page: NextPageWithLayout<Props> = (props: Props) => {
  // register global EventEmitter
  if (isClient() && window.globalEmitter == null) {
    window.globalEmitter = new EventEmitter();
  }

  const router = useRouter();

  useCurrentUser(props.currentUser ?? null);

  // commons
  useCsrfToken(props.csrfToken);
  useGrowiCloudUri(props.growiCloudUri);

  // page
  useIsContainerFluid(props.isContainerFluid);
  // useOwnerOfCurrentPage(props.pageUser != null ? JSON.parse(props.pageUser) : null);
  useIsForbidden(props.isForbidden);
  useIsNotCreatable(props.isNotCreatable);
  useRedirectFrom(props.redirectFrom ?? null);
  useIsSharedUser(false); // this page cann't be routed for '/share'
  useIsIdenticalPath(props.isIdenticalPathPage ?? false);
  useIsEnabledStaleNotification(props.isEnabledStaleNotification);
  useIsSearchPage(false);

  useIsEnabledAttachTitleHeader(props.isEnabledAttachTitleHeader);
  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useElasticsearchMaxBodyLengthToIndex(props.elasticsearchMaxBodyLengthToIndex);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);

  useIsSlackConfigured(props.isSlackConfigured);
  // useIsMailerSetup(props.isMailerSetup);
  useIsAclEnabled(props.isAclEnabled);
  // useHasSlackConfig(props.hasSlackConfig);
  useDefaultIndentSize(props.adminPreferredIndentSize);
  useIsIndentSizeForced(props.isIndentSizeForced);
  useDisableLinkSharing(props.disableLinkSharing);
  useRendererConfig(props.rendererConfig);
  useIsEnabledMarp(props.rendererConfig.isEnabledMarp);
  // useRendererSettings(props.rendererSettingsStr != null ? JSON.parse(props.rendererSettingsStr) : undefined);
  // useGrowiRendererConfig(props.growiRendererConfigStr != null ? JSON.parse(props.growiRendererConfigStr) : undefined);
  useIsAllReplyShown(props.isAllReplyShown);
  useShowPageSideAuthors(props.showPageSideAuthors);

  useIsUploadAllFileAllowed(props.isUploadAllFileAllowed);
  useIsUploadEnabled(props.isUploadEnabled);
  useIsBulkExportPagesEnabled(props.isBulkExportPagesEnabled);
  useIsPdfBulkExportEnabled(props.isPdfBulkExportEnabled);

  useIsLocalAccountRegistrationEnabled(props.isLocalAccountRegistrationEnabled);
  useIsRomUserAllowedToComment(props.isRomUserAllowedToComment);

  useIsAiEnabled(props.aiEnabled);
  useLimitLearnablePageCountPerAssistant(props.limitLearnablePageCountPerAssistant);

  useIsUsersHomepageDeletionEnabled(props.isUsersHomepageDeletionEnabled);


  const { pageWithMeta } = props;

  const pageId = pageWithMeta?.data._id;
  const revisionId = pageWithMeta?.data.revision?._id;
  const revisionBody = pageWithMeta?.data.revision?.body;

  useCurrentPathname(props.currentPathname);

  const { data: currentPage } = useSWRxCurrentPage(pageWithMeta?.data ?? null); // store initial data

  const { trigger: mutateCurrentPage } = useSWRMUTxCurrentPage();
  const { trigger: mutateCurrentPageYjsDataFromApi } = useSWRMUTxCurrentPageYjsData();

  const { mutate: mutateEditingMarkdown } = useEditingMarkdown();
  const { data: currentPageId, mutate: mutateCurrentPageId } = useCurrentPageId();

  const { mutate: mutateIsNotFound } = useIsNotFound();

  const { mutate: mutateIsLatestRevision } = useIsLatestRevision();

  const { mutate: mutateRemoteRevisionId } = useRemoteRevisionId();

  const { mutate: mutateTemplateTagData } = useTemplateTagData();
  const { mutate: mutateTemplateBodyData } = useTemplateBodyData();

  const { mutate: mutateCurrentPageYjsData } = useCurrentPageYjsData();

  useSetupGlobalSocket();
  useSetupGlobalSocketForPage(pageId);

  // Store initial data (When revisionBody is not SSR)
  useEffect(() => {
    if (!props.skipSSR) {
      return;
    }

    if (currentPageId != null && revisionId != null && !props.isNotFound) {
      const mutatePageData = async() => {
        const pageData = await mutateCurrentPage();
        mutateEditingMarkdown(pageData?.revision?.body);
      };

      // If skipSSR is true, use the API to retrieve page data.
      // Because pageWIthMeta does not contain revision.body
      mutatePageData();
    }
  }, [
    revisionId, currentPageId, mutateCurrentPage,
    mutateCurrentPageYjsDataFromApi, mutateEditingMarkdown, props.isNotFound, props.skipSSR,
  ]);

  // Load current yjs data
  useEffect(() => {
    if (currentPageId != null && revisionId != null && !props.isNotFound) {
      mutateCurrentPageYjsDataFromApi();
    }
  }, [currentPageId, mutateCurrentPageYjsDataFromApi, props.isNotFound, revisionId]);

  // sync pathname by Shallow Routing https://nextjs.org/docs/routing/shallow-routing
  useEffect(() => {
    const decodedURI = decodeURI(window.location.pathname);
    if (isClient() && decodedURI !== props.currentPathname) {
      const { search, hash } = window.location;
      router.replace(`${props.currentPathname}${search}${hash}`, undefined, { shallow: true });
    }
  }, [props.currentPathname, router]);

  // initialize mutateEditingMarkdown only once per page
  // need to include useCurrentPathname not useCurrentPagePath
  useEffect(() => {
    if (props.currentPathname != null) {
      mutateEditingMarkdown(revisionBody);
    }
  }, [mutateEditingMarkdown, revisionBody, props.currentPathname]);

  useEffect(() => {
    mutateRemoteRevisionId(revisionId);
  }, [mutateRemoteRevisionId, revisionId]);

  useEffect(() => {
    mutateCurrentPageId(pageId ?? null);
  }, [mutateCurrentPageId, pageId]);

  useEffect(() => {
    mutateIsNotFound(props.isNotFound);
  }, [mutateIsNotFound, props.isNotFound]);

  useEffect(() => {
    mutateIsLatestRevision(props.isLatestRevision);
  }, [mutateIsLatestRevision, props.isLatestRevision]);

  useEffect(() => {
    mutateTemplateTagData(props.templateTagData);
  }, [props.templateTagData, mutateTemplateTagData]);

  useEffect(() => {
    mutateTemplateBodyData(props.templateBodyData);
  }, [props.templateBodyData, mutateTemplateBodyData]);

  useEffect(() => {
    mutateCurrentPageYjsData(props.yjsData);
  }, [mutateCurrentPageYjsData, props.yjsData]);

  // If the data on the page changes without router.push, pageWithMeta remains old because getServerSideProps() is not executed
  // So preferentially take page data from useSWRxCurrentPage
  const pagePath = currentPage?.path ?? pageWithMeta?.data.path ?? props.currentPathname;

  const title = generateCustomTitleForPage(props, pagePath);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root justify-content-between">

        <GrowiContextualSubNavigation isLinkSharingDisabled={props.disableLinkSharing} />

        <PageView
          className="d-edit-none"
          pagePath={pagePath}
          initialPage={pageWithMeta?.data}
          rendererConfig={props.rendererConfig}
        />

        <EditablePageEffects />
        <DisplaySwitcher />

        <PageStatusAlert />
      </div>
    </>
  );
};


const BasicLayoutWithEditor = ({ children }: { children?: ReactNode }): JSX.Element => {
  const editorModeClassName = useEditorModeClassName();
  return <BasicLayout className={editorModeClassName}>{children}</BasicLayout>;
};

type LayoutProps = Props & {
  children?: ReactNode
}

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  return <BasicLayoutWithEditor>{children}</BasicLayoutWithEditor>;
};

Page.getLayout = function getLayout(page: React.ReactElement<Props>) {
  return (
    <>
      <GrowiPluginsActivator />
      <DrawioViewerScript drawioUri={page.props.rendererConfig.drawioUri} />

      <Layout {...page.props}>
        {page}
      </Layout>
      <UnsavedAlertDialog />
      <DescendantsPageListModal />
      <DrawioModal />
      <HandsontableModal />
      <TemplateModal />
      <LinkEditModal />
      <TagEditModal />
      <ConflictDiffModal />
    </>
  );
};


function getPageIdFromPathname(currentPathname: string): string | null {
  return _isPermalink(currentPathname) ? removeHeadingSlash(currentPathname) : null;
}

class MultiplePagesHitsError extends ExtensibleCustomError {

  pagePath: string;

  constructor(pagePath: string) {
    super(`MultiplePagesHitsError occured by '${pagePath}'`);
    this.pagePath = pagePath;
  }

}

async function injectPageData(context: GetServerSidePropsContext, props: Props): Promise<void> {
  const { model: mongooseModel } = await import('mongoose');

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { revisionId } = req.query;

  const Page = crowi.model('Page') as PageModel;
  const PageRedirect = mongooseModel('PageRedirect') as PageRedirectModel;
  const { pageService, configManager } = crowi;

  let currentPathname = props.currentPathname;

  const pageId = getPageIdFromPathname(currentPathname);
  const isPermalink = _isPermalink(currentPathname);

  const { user } = req;

  if (!isPermalink) {
    // check redirects
    const chains = await PageRedirect.retrievePageRedirectEndpoints(currentPathname);
    if (chains != null) {
      // overwrite currentPathname
      currentPathname = chains.end.toPath;
      props.currentPathname = currentPathname;
      // set redirectFrom
      props.redirectFrom = chains.start.fromPath;
    }

    // check whether the specified page path hits to multiple pages
    const count = await Page.countByPathAndViewer(currentPathname, user, null, true);
    if (count > 1) {
      throw new MultiplePagesHitsError(currentPathname);
    }
  }

  const pageWithMeta = await pageService.findPageAndMetaDataByViewer(pageId, currentPathname, user, true); // includeEmpty = true, isSharedPage = false
  const { data: page, meta } = pageWithMeta ?? {};

  // add user to seen users
  if (page != null && user != null) {
    await page.seen(user);
  }

  props.pageWithMeta = null;

  // populate & check if the revision is latest
  if (page != null) {
    page.initLatestRevisionField(revisionId);
    props.isLatestRevision = page.isLatestRevision();
    const ssrMaxRevisionBodyLength = configManager.getConfig('app:ssrMaxRevisionBodyLength');
    props.skipSSR = await skipSSR(page, ssrMaxRevisionBodyLength);
    const populatedPage = await page.populateDataToShowRevision(props.skipSSR); // shouldExcludeBody = skipSSR

    props.pageWithMeta = {
      data: populatedPage,
      meta,
    };
  }
}

async function injectRoutingInformation(context: GetServerSidePropsContext, props: Props): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const Page = crowi.model('Page') as PageModel;

  const { currentPathname } = props;
  const pageId = getPageIdFromPathname(currentPathname);
  const isPermalink = _isPermalink(currentPathname);

  const page = props.pageWithMeta?.data;

  if (props.isIdenticalPathPage) {
    props.isNotCreatable = true;
  }
  else if (page == null) {
    props.isNotFound = true;
    props.isNotCreatable = !isCreatablePage(currentPathname);
    // check the page is forbidden or just does not exist.
    const count = isPermalink ? await Page.count({ _id: pageId }) : await Page.count({ path: currentPathname });
    props.isForbidden = count > 0;
  }
  else {
    props.isNotFound = page.isEmpty;
    props.isNotCreatable = false;
    props.isForbidden = false;
    // /62a88db47fed8b2d94f30000 ==> /path/to/page
    if (isPermalink && page.isEmpty) {
      props.currentPathname = page.path;
    }

    // /path/to/page ==> /62a88db47fed8b2d94f30000
    if (!isPermalink && !page.isEmpty) {
      const isToppage = pagePathUtils.isTopPage(props.currentPathname);
      if (!isToppage) {
        props.currentPathname = `/${page._id}`;
      }
    }

    if (!props.skipSSR) {
      props.yjsData = await crowi.pageService.getYjsData(page._id.toString());
    }
  }
}

// async function injectPageUserInformation(context: GetServerSidePropsContext, props: Props): Promise<void> {
//   const req: CrowiRequest = context.req as CrowiRequest;
//   const { crowi } = req;
//   const UserModel = crowi.model('User');

//   if (isUserPage(props.currentPagePath)) {
//     const user = await UserModel.findUserByUsername(UserModel.getUsernameByPath(props.currentPagePath));

//     if (user != null) {
//       props.pageUser = JSON.stringify(user.toObject());
//     }
//   }
// }

function injectServerConfigurations(context: GetServerSidePropsContext, props: Props): void {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const {
    configManager, searchService, aclService, fileUploadService,
    slackIntegrationService, passportService,
  } = crowi;

  props.aiEnabled = configManager.getConfig('app:aiEnabled');
  props.limitLearnablePageCountPerAssistant = configManager.getConfig('openai:limitLearnablePageCountPerAssistant');
  props.isUsersHomepageDeletionEnabled = configManager.getConfig('security:user-homepage-deletion:isEnabled');
  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig('customize:isSearchScopeChildrenAsDefault');
  props.elasticsearchMaxBodyLengthToIndex = configManager.getConfig('app:elasticsearchMaxBodyLengthToIndex');

  props.isRomUserAllowedToComment = configManager.getConfig('security:isRomUserAllowedToComment');

  props.isSlackConfigured = slackIntegrationService.isSlackConfigured;
  // props.isMailerSetup = mailService.isMailerSetup;
  props.isAclEnabled = aclService.isAclEnabled();
  // props.hasSlackConfig = slackNotificationService.hasSlackConfig();
  props.drawioUri = configManager.getConfig('app:drawioUri');
  // props.highlightJsStyle = configManager.getConfig('customize:highlightJsStyle');
  props.isAllReplyShown = configManager.getConfig('customize:isAllReplyShown');
  props.showPageSideAuthors = configManager.getConfig('customize:showPageSideAuthors');
  props.isContainerFluid = configManager.getConfig('customize:isContainerFluid');
  props.isEnabledStaleNotification = configManager.getConfig('customize:isEnabledStaleNotification');
  props.disableLinkSharing = configManager.getConfig('security:disableLinkSharing');
  props.isUploadAllFileAllowed = fileUploadService.getFileUploadEnabled();
  props.isUploadEnabled = fileUploadService.getIsUploadable();
  // TODO: remove growiCloudUri condition when bulk export can be relased for GROWI.cloud (https://redmine.weseek.co.jp/issues/163220)
  props.isBulkExportPagesEnabled = configManager.getConfig('app:isBulkExportPagesEnabled') && configManager.getConfig('app:growiCloudUri') == null;
  props.isPdfBulkExportEnabled = configManager.getConfig('app:pageBulkExportPdfConverterUri') != null;

  props.isLocalAccountRegistrationEnabled = passportService.isLocalStrategySetup
  && configManager.getConfig('security:registrationMode') !== RegistrationMode.CLOSED;

  props.adminPreferredIndentSize = configManager.getConfig('markdown:adminPreferredIndentSize');
  props.isIndentSizeForced = configManager.getConfig('markdown:isIndentSizeForced');

  props.isEnabledAttachTitleHeader = configManager.getConfig('customize:isEnabledAttachTitleHeader');

  props.sidebarConfig = {
    isSidebarCollapsedMode: configManager.getConfig('customize:isSidebarCollapsedMode'),
    isSidebarClosedAtDockMode: configManager.getConfig('customize:isSidebarClosedAtDockMode'),
  };

  props.rendererConfig = {
    isEnabledLinebreaks: configManager.getConfig('markdown:isEnabledLinebreaks'),
    isEnabledLinebreaksInComments: configManager.getConfig('markdown:isEnabledLinebreaksInComments'),
    isEnabledMarp: configManager.getConfig('customize:isEnabledMarp'),
    adminPreferredIndentSize: configManager.getConfig('markdown:adminPreferredIndentSize'),
    isIndentSizeForced: configManager.getConfig('markdown:isIndentSizeForced'),

    drawioUri: configManager.getConfig('app:drawioUri'),
    plantumlUri: configManager.getConfig('app:plantumlUri'),

    // XSS Options
    isEnabledXssPrevention: configManager.getConfig('markdown:rehypeSanitize:isEnabledPrevention'),
    sanitizeType: configManager.getConfig('markdown:rehypeSanitize:option'),
    customTagWhitelist: configManager.getConfig('markdown:rehypeSanitize:tagNames'),
    customAttrWhitelist: configManager.getConfig('markdown:rehypeSanitize:attributes') != null
      ? JSON.parse(configManager.getConfig('markdown:rehypeSanitize:attributes'))
      : undefined,
    highlightJsStyleBorder: configManager.getConfig('customize:highlightJsStyleBorder'),
  };

  props.ssrMaxRevisionBodyLength = configManager.getConfig('app:ssrMaxRevisionBodyLength');
}

/**
 * for Server Side Translations
 * @param context
 * @param props
 * @param namespacesRequired
 */
async function injectNextI18NextConfigurations(context: GetServerSidePropsContext, props: Props, namespacesRequired?: string[] | undefined): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(serverSideTranslations, context, namespacesRequired);
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

const getAction = (props: Props): SupportedActionType => {
  if (props.isNotCreatable) {
    return SupportedAction.ACTION_PAGE_NOT_CREATABLE;
  }
  if (props.isForbidden) {
    return SupportedAction.ACTION_PAGE_FORBIDDEN;
  }
  if (props.isNotFound) {
    return SupportedAction.ACTION_PAGE_NOT_FOUND;
  }
  if (pagePathUtils.isUsersHomepage(props.pageWithMeta?.data.path ?? '')) {
    return SupportedAction.ACTION_PAGE_USER_HOME_VIEW;
  }
  return SupportedAction.ACTION_PAGE_VIEW;
};

export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const req = context.req as CrowiRequest;
  const { user } = req;

  const result = await getServerSideCommonProps(context);

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  if (props.redirectDestination != null) {
    return {
      redirect: {
        permanent: false,
        destination: props.redirectDestination,
      },
    };
  }

  if (user != null) {
    props.currentUser = user.toObject();
  }

  try {
    await injectPageData(context, props);
  }
  catch (err) {
    if (err instanceof MultiplePagesHitsError) {
      props.isIdenticalPathPage = true;
    }
    else {
      throw err;
    }
  }

  await injectRoutingInformation(context, props);
  injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, ['translation']);

  addActivity(context, getAction(props));
  return {
    props,
  };
};

export default Page;
