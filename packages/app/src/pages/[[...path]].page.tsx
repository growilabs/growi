import React, { useEffect } from 'react';

import { isClient, pagePathUtils, pathUtils } from '@growi/core';
import ExtensibleCustomError from 'extensible-custom-error';
import mongoose from 'mongoose';
import {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { PageAlerts } from '~/components/PageAlert/PageAlerts';
// import { PageComments } from '~/components/PageComment/PageComments';
// import { useTranslation } from '~/i18n';
import { CrowiRequest } from '~/interfaces/crowi-request';
// import { renderScriptTagByName, renderHighlightJsStyleTag } from '~/service/cdn-resources-loader';
// import { useIndentSize } from '~/stores/editor';
// import { useRendererSettings } from '~/stores/renderer';
// import { EditorMode, useEditorMode, useIsMobile } from '~/stores/ui';
import { IPageWithMeta } from '~/interfaces/page';
import { ISidebarConfig } from '~/interfaces/sidebar-config';
import { PageModel, PageDocument } from '~/server/models/page';
import { PageRedirectModel, PageRedirectDocument } from '~/server/models/page-redirect';
import UserUISettings, { UserUISettingsDocument } from '~/server/models/user-ui-settings';
import Xss from '~/services/xss';
import { useSWRxCurrentPage, useSWRxPageInfo, useSWRxPage } from '~/stores/page';
import {
  usePreferDrawerModeByUser, usePreferDrawerModeOnEditByUser, useSidebarCollapsed, useCurrentSidebarContents, useCurrentProductNavWidth,
} from '~/stores/ui';
import loggerFactory from '~/utils/logger';


// import { isUserPage, isTrashPage, isSharedPage } from '~/utils/path-utils';

// import GrowiSubNavigation from '../client/js/components/Navbar/GrowiSubNavigation';
// import GrowiSubNavigationSwitcher from '../client/js/components/Navbar/GrowiSubNavigationSwitcher';
import { BasicLayout } from '../components/BasicLayout';
import DisplaySwitcher from '../components/Page/DisplaySwitcher';

// import { serializeUserSecurely } from '../server/models/serializers/user-serializer';
// import PageStatusAlert from '../client/js/components/PageStatusAlert';


import {
  useCurrentUser, useCurrentPagePath,
  useOwnerOfCurrentPage, useIsLatestRevision,
  useIsForbidden, useIsNotFound, useIsTrashPage, useShared, useShareLinkId, useIsSharedUser, useIsAbleToDeleteCompletely,
  useAppTitle, useSiteUrl, useConfidential, useIsEnabledStaleNotification,
  useIsSearchServiceConfigured, useIsSearchServiceReachable, useIsMailerSetup, useRedirectFrom, useRedirectTo,
  useAclEnabled, useIsAclEnabled, useHasSlackConfig, useDrawioUri, useHackmdUri, useMathJax,
  useNoCdn, useEditorConfig, useCsrfToken, useIsSearchScopeChildrenAsDefault, useCurrentPageId, useCurrentPathname, useIsSlackConfigured,
} from '../stores/context';
import { useXss } from '../stores/xss';

import {
  CommonProps, getNextI18NextConfig, getServerSideCommonProps, useCustomTitle,
} from './commons';
// import { useCurrentPageSWR } from '../stores/page';


const logger = loggerFactory('growi:pages:all');
const { isPermalink: _isPermalink, isUsersHomePage, isTrashPage: _isTrashPage } = pagePathUtils;
const { removeHeadingSlash } = pathUtils;


const IdenticalPathPage = (): JSX.Element => {
  const IdenticalPathPage = dynamic(() => import('../components/IdenticalPathPage').then(mod => mod.IdenticalPathPage), { ssr: false });
  return <IdenticalPathPage />;
};


type ServerSideLocalProps = {
  pageRedirect?: PageRedirectDocument | null | undefined;
}

type Props = CommonProps & {
  currentUser: string,

  pageWithMetaStr: string,
  // pageUser?: any,
  redirectFrom?: string;
  redirectTo?: string;

  // shareLinkId?: string;
  isLatestRevision?: boolean

  isIdenticalPathPage?: boolean,
  isForbidden: boolean,
  isNotFound: boolean,
  // isAbleToDeleteCompletely: boolean,

  isSearchServiceConfigured: boolean,
  isSearchServiceReachable: boolean,
  isSearchScopeChildrenAsDefault: boolean,

  isSlackConfigured: boolean,
  // isMailerSetup: boolean,
  isAclEnabled: boolean,
  // hasSlackConfig: boolean,
  // drawioUri: string,
  // hackmdUri: string,
  // mathJax: string,
  // noCdn: string,
  // highlightJsStyle: string,
  // isAllReplyShown: boolean,
  // isContainerFluid: boolean,
  // editorConfig: any,
  isEnabledStaleNotification: boolean,
  // isEnabledLinebreaks: boolean,
  // isEnabledLinebreaksInComments: boolean,
  // adminPreferredIndentSize: number,
  // isIndentSizeForced: boolean,

  // UI
  userUISettings: UserUISettingsDocument | null
  // Sidebar
  sidebarConfig: ISidebarConfig,
};

const GrowiPage: NextPage<Props> = (props: Props) => {
  // const { t } = useTranslation();
  const router = useRouter();

  const UnsavedAlertDialog = dynamic(() => import('./UnsavedAlertDialog'), { ssr: false });

  const { data: currentUser } = useCurrentUser(props.currentUser != null ? JSON.parse(props.currentUser) : null);

  // commons
  useAppTitle(props.appTitle);
  useSiteUrl(props.siteUrl);
  useXss(new Xss());
  // useEditorConfig(props.editorConfig);
  useConfidential(props.confidential);
  useCsrfToken(props.csrfToken);

  // UserUISettings
  usePreferDrawerModeByUser(props.userUISettings?.preferDrawerModeByUser ?? props.sidebarConfig.isSidebarDrawerMode);
  usePreferDrawerModeOnEditByUser(props.userUISettings?.preferDrawerModeOnEditByUser);
  useSidebarCollapsed(props.userUISettings?.isSidebarCollapsed ?? props.sidebarConfig.isSidebarClosedAtDockMode);
  useCurrentSidebarContents(props.userUISettings?.currentSidebarContents);
  useCurrentProductNavWidth(props.userUISettings?.currentProductNavWidth);

  // page
  useCurrentPagePath(props.currentPathname);
  useIsLatestRevision(props.isLatestRevision);
  // useOwnerOfCurrentPage(props.pageUser != null ? JSON.parse(props.pageUser) : null);
  useIsForbidden(props.isForbidden);
  useIsNotFound(props.isNotFound);
  // useIsTrashPage(_isTrashPage(props.currentPagePath));u
  useRedirectFrom(props.redirectFrom);
  useRedirectTo(props.redirectTo);
  // useShared();
  // useShareLinkId(props.shareLinkId);
  // useIsAbleToDeleteCompletely(props.isAbleToDeleteCompletely);
  useIsSharedUser(false); // this page cann't be routed for '/share'
  useIsEnabledStaleNotification(props.isEnabledStaleNotification);

  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);

  useIsSlackConfigured(props.isSlackConfigured);
  // useIsMailerSetup(props.isMailerSetup);
  useIsAclEnabled(props.isAclEnabled);
  // useHasSlackConfig(props.hasSlackConfig);
  // useDrawioUri(props.drawioUri);
  // useHackmdUri(props.hackmdUri);
  // useMathJax(props.mathJax);
  // useNoCdn(props.noCdn);
  // useIndentSize(props.adminPreferredIndentSize);

  // useRendererSettings({
  //   isEnabledLinebreaks: props.isEnabledLinebreaks,
  //   isEnabledLinebreaksInComments: props.isEnabledLinebreaksInComments,
  //   adminPreferredIndentSize: props.adminPreferredIndentSize,
  //   isIndentSizeForced: props.isIndentSizeForced,
  // });

  // const { data: editorMode } = useEditorMode();

  let pageWithMeta: IPageWithMeta | undefined;
  if (props.pageWithMetaStr != null) {
    pageWithMeta = JSON.parse(props.pageWithMetaStr) as IPageWithMeta;
  }
  useCurrentPageId(pageWithMeta?.data._id);
  useSWRxCurrentPage(undefined, pageWithMeta?.data); // store initial data
  // useSWRxPage(pageWithMeta?.data._id);
  useSWRxPageInfo(pageWithMeta?.data._id, undefined, pageWithMeta?.meta); // store initial data
  useIsTrashPage(_isTrashPage(pageWithMeta?.data.path ?? ''));
  useCurrentPagePath(pageWithMeta?.data.path);
  useCurrentPathname(props.currentPathname);

  // sync pathname by Shallow Routing https://nextjs.org/docs/routing/shallow-routing
  useEffect(() => {
    if (isClient() && window.location.pathname !== props.currentPathname) {
      router.replace(props.currentPathname, undefined, { shallow: true });
    }
  }, [props.currentPathname, router]);

  const classNames: string[] = [];
  // switch (editorMode) {
  //   case EditorMode.Editor:
  //     classNames.push('on-edit', 'builtin-editor');
  //     break;
  //   case EditorMode.HackMD:
  //     classNames.push('on-edit', 'hackmd');
  //     break;
  // }
  // if (props.isContainerFluid) {
  //   classNames.push('growi-layout-fluid');
  // }
  // if (page == null) {
  //   classNames.push('not-found-page');
  // }

  return (
    <>
      <Head>
        {/*
        {renderScriptTagByName('drawio-viewer')}
        {renderScriptTagByName('mathjax')}
        {renderScriptTagByName('highlight-addons')}
        {renderHighlightJsStyleTag(props.highlightJsStyle)}
        */}
      </Head>
      {/* <BasicLayout title={useCustomTitle(props, t('GROWI'))} className={classNames.join(' ')}> */}
      <BasicLayout title={useCustomTitle(props, 'GROWI')} className={classNames.join(' ')}>
        <header className="py-0">
          {/* <GrowiSubNavigation /> */}
          GrowiSubNavigation
        </header>
        <div className="d-edit-none">
          {/* <GrowiSubNavigationSwitcher /> */}
          GrowiSubNavigationSwitcher
        </div>

        <div id="grw-subnav-sticky-trigger" className="sticky-top"></div>
        <div id="grw-fav-sticky-trigger" className="sticky-top"></div>

        <div id="main" className={`main ${isUsersHomePage(props.currentPathname) && 'user-page'}`}>

          <div className="row">
            <div className="col">
              <div id="content-main" className="content-main grw-container-convertible">
                { props.isIdenticalPathPage && <IdenticalPathPage /> }

                { !props.isIdenticalPathPage && (
                  <>
                    <PageAlerts />
                    { props.isForbidden
                      ? <>ForbiddenPage</>
                      : <DisplaySwitcher />
                    }
                    <div id="page-editor-navbar-bottom-container" className="d-none d-edit-block"></div>
                    {/* <PageStatusAlert /> */}
                    PageStatusAlert
                  </>
                ) }

              </div>
            </div>

            {/* <div className="col-xl-2 col-lg-3 d-none d-lg-block revision-toc-container">
              <div id="revision-toc" className="revision-toc mt-3 sps sps--abv" data-sps-offset="123">
                <div id="revision-toc-content" className="revision-toc-content"></div>
              </div>
            </div> */}
          </div>

        </div>
        <footer>
          {/* <PageComments /> */}
          PageComments
        </footer>

        <UnsavedAlertDialog />

      </BasicLayout>
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

async function getPageRedirect(req: CrowiRequest, props: Props): Promise<PageRedirectDocument | null | undefined> {
  // Page Redirection - retrieve a PageRedirect doc with a fromPath matching the specified path if any
  const PageRedirect = mongoose.model('PageRedirect') as unknown as PageRedirectModel;
  const { crowi } = req;
  const { currentPathname } = props;
  const isPermalink = _isPermalink(currentPathname);
  const withRedirect = req.query.withRedirect === 'true';

  if (!isPermalink) {
    return PageRedirect.findOne({ fromPath: currentPathname });
  }
  if (isPermalink && withRedirect) {
    const Page = crowi.model('Page') as PageModel;
    const pageId = getPageIdFromPathname(currentPathname);
    const page = await Page.findById(pageId);
    if (page != null) {
      return PageRedirect.findOne({ toPath: page.path });
    }
  }
}

function injectRedirectInformation(props: Props, sslProps: ServerSideLocalProps): void {
  const { pageRedirect } = sslProps;
  if (pageRedirect) {
    props.redirectFrom = pageRedirect.fromPath;
    props.redirectTo = pageRedirect.toPath;
  }
}

async function getPageData(context: GetServerSidePropsContext, props: Props, sslProps: ServerSideLocalProps): Promise<IPageWithMeta|null> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { revisionId } = req.query;

  const Page = crowi.model('Page') as PageModel;
  const { pageService } = crowi;

  const { currentPathname } = props;

  const pageId = getPageIdFromPathname(currentPathname);
  const isPermalink = _isPermalink(currentPathname);

  const { user } = req;

  // check whether the specified page path hits to multiple pages
  if (!isPermalink) {
    const count = await Page.countByPathAndViewer(currentPathname, user, null, true);
    if (count > 1) {
      throw new MultiplePagesHitsError(currentPathname);
    }
  }

  const { pageRedirect } = sslProps;
  // search with redirectTo if PageRedirect exists
  const searchingPath = pageRedirect != null ? pageRedirect.toPath : currentPathname;
  const result: IPageWithMeta = await pageService.findPageAndMetaDataByViewer(pageId, searchingPath, user, true); // includeEmpty = true, isSharedPage = false
  const page = result?.data as unknown as PageDocument;

  // populate & check if the revision is latest
  if (page != null) {
    page.initLatestRevisionField(revisionId);
    await page.populateDataToShowRevision();
    props.isLatestRevision = page.isLatestRevision();
  }

  return result;
}

async function injectRoutingInformation(context: GetServerSidePropsContext, props: Props, pageWithMeta: IPageWithMeta|null): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const Page = crowi.model('Page') as PageModel;

  const { currentPathname } = props;
  const pageId = getPageIdFromPathname(currentPathname);
  const isPermalink = _isPermalink(currentPathname);

  const page = pageWithMeta?.data;

  if (props.isIdenticalPathPage) {
    // TBD
  }
  else if (page == null) {
    props.isNotFound = true;

    // check the page is forbidden or just does not exist.
    const count = isPermalink ? await Page.count({ _id: pageId }) : await Page.count({ path: currentPathname });
    props.isForbidden = count > 0;
  }
  else {
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

async function injectServerConfigurations(context: GetServerSidePropsContext, props: Props): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const {
    appService, searchService, configManager, aclService, slackNotificationService, mailService,
  } = crowi;

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig('crowi', 'customize:isSearchScopeChildrenAsDefault');

  props.isSlackConfigured = crowi.slackIntegrationService.isSlackConfigured;
  // props.isMailerSetup = mailService.isMailerSetup;
  props.isAclEnabled = aclService.isAclEnabled();
  // props.hasSlackConfig = slackNotificationService.hasSlackConfig();
  // props.drawioUri = configManager.getConfig('crowi', 'app:drawioUri');
  // props.hackmdUri = configManager.getConfig('crowi', 'app:hackmdUri');
  // props.mathJax = configManager.getConfig('crowi', 'app:mathJax');
  // props.noCdn = configManager.getConfig('crowi', 'app:noCdn');
  // props.highlightJsStyle = configManager.getConfig('crowi', 'customize:highlightJsStyle');
  // props.isAllReplyShown = configManager.getConfig('crowi', 'customize:isAllReplyShown');
  // props.isContainerFluid = configManager.getConfig('crowi', 'customize:isContainerFluid');
  props.isEnabledStaleNotification = configManager.getConfig('crowi', 'customize:isEnabledStaleNotification');
  // props.isEnabledLinebreaks = configManager.getConfig('markdown', 'markdown:isEnabledLinebreaks');
  // props.isEnabledLinebreaksInComments = configManager.getConfig('markdown', 'markdown:isEnabledLinebreaksInComments');
  // props.editorConfig = {
  //   upload: {
  //     image: crowi.fileUploadService.getIsUploadable(),
  //     file: crowi.fileUploadService.getFileUploadEnabled(),
  //   },
  // };
  // props.adminPreferredIndentSize = configManager.getConfig('markdown', 'markdown:adminPreferredIndentSize');
  // props.isIndentSizeForced = configManager.getConfig('markdown', 'markdown:isIndentSizeForced');

  props.sidebarConfig = {
    isSidebarDrawerMode: configManager.getConfig('crowi', 'customize:isSidebarDrawerMode'),
    isSidebarClosedAtDockMode: configManager.getConfig('crowi', 'customize:isSidebarClosedAtDockMode'),
  };
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

export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { user } = req;

  const result = await getServerSideCommonProps(context);


  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  const sslProps: ServerSideLocalProps = {}; // props only to use inside getServerSideProps and is not passed to the client
  sslProps.pageRedirect = await getPageRedirect(req, props);

  let pageWithMeta;
  try {
    pageWithMeta = await getPageData(context, props, sslProps);
    props.pageWithMetaStr = JSON.stringify(pageWithMeta);
  }
  catch (err) {
    if (err instanceof MultiplePagesHitsError) {
      props.isIdenticalPathPage = true;
    }
    else {
      throw err;
    }
  }

  injectRoutingInformation(context, props, pageWithMeta);
  injectRedirectInformation(props, sslProps);
  injectServerConfigurations(context, props);
  injectNextI18NextConfigurations(context, props, ['translation']);

  if (user != null) {
    props.currentUser = JSON.stringify(user);
  }

  // UI
  const userUISettings = user == null ? null : await UserUISettings.findOne({ user: user._id }).exec();
  props.userUISettings = JSON.parse(JSON.stringify(userUISettings));

  return {
    props,
  };
};

export default GrowiPage;
