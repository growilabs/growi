import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type {
  IDataWithMeta,
  IDataWithRequiredMeta,
  IPageInfoBasic,
  IPageNotFoundInfo,
} from '@growi/core';
import { isIPageNotFoundInfo } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { PageDocument } from '~/server/models/page';

import { getServerSideBasicLayoutProps } from '../basic-layout-page';
import {
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import {
  getServerSideGeneralPageProps,
  getServerSideRendererConfigProps,
} from '../general-page';
import { isValidGeneralPageInitialProps } from '../general-page/type-guards';
import type { IPageToShowRevisionWithMeta } from '../general-page/types';
import { addActivity } from '../utils/activity';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import { NEXT_JS_ROUTING_PAGE } from './consts';
import {
  getPageDataForInitial,
  getPageDataForSameRoute,
} from './page-data-props';
import type { Stage2EachProps, Stage2InitialProps } from './types';

const nextjsRoutingProps = {
  props: {
    nextjsRoutingPage: NEXT_JS_ROUTING_PAGE,
  },
};

/**
 * Emit page seen event
 * @param context - Next.js server-side context
 * @param pageId - Page ID to mark as seen
 */
function emitPageSeenEvent(
  context: GetServerSidePropsContext,
  pageId?: string,
): void {
  if (pageId == null) {
    return;
  }

  const req = context.req as CrowiRequest;
  const { user, crowi } = req;

  if (user == null) {
    return;
  }

  const pageEvent = crowi.event('page');
  pageEvent.emit('seen', pageId, user);
}

function getActivityAction(
  isIdenticalPathPage: boolean,
  pageWithMeta?:
    | IPageToShowRevisionWithMeta
    | IDataWithRequiredMeta<PageDocument, IPageInfoBasic>
    | IDataWithMeta<null, IPageNotFoundInfo>
    | null,
): SupportedActionType {
  if (isIdenticalPathPage) {
    return SupportedAction.ACTION_PAGE_NOT_CREATABLE;
  }

  const meta = pageWithMeta?.meta;
  if (isIPageNotFoundInfo(meta)) {
    if (meta.isForbidden) {
      return SupportedAction.ACTION_PAGE_FORBIDDEN;
    }

    if (meta.isNotFound) {
      return SupportedAction.ACTION_PAGE_NOT_FOUND;
    }
  }

  const pagePath = pageWithMeta?.data?.path;
  if (pagePath != null) {
    if (pagePathUtils.isUsersHomepage(pagePath)) {
      return SupportedAction.ACTION_PAGE_USER_HOME_VIEW;
    }

    if (!pagePathUtils.isCreatablePage(pagePath)) {
      return SupportedAction.ACTION_PAGE_NOT_CREATABLE;
    }
  }

  return SupportedAction.ACTION_PAGE_VIEW;
}

export async function getServerSidePropsForInitial(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2InitialProps>> {
  const [
    commonInitialResult,
    basicLayoutResult,
    generalPageResult,
    rendererConfigResult,
    i18nPropsResult,
    pageDataResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideGeneralPageProps(context),
    getServerSideRendererConfigProps(context),
    getServerSideI18nProps(context, ['translation']),
    getPageDataForInitial(context),
  ]);

  // Merge all results in a type-safe manner (using sequential merging)
  const mergedResult = mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      basicLayoutResult,
      mergeGetServerSidePropsResults(
        generalPageResult,
        mergeGetServerSidePropsResults(
          rendererConfigResult,
          mergeGetServerSidePropsResults(
            i18nPropsResult,
            mergeGetServerSidePropsResults(pageDataResult, nextjsRoutingProps),
          ),
        ),
      ),
    ),
  );

  // Check for early return (redirect/notFound)
  if ('redirect' in mergedResult || 'notFound' in mergedResult) {
    return mergedResult;
  }

  const mergedProps = await mergedResult.props;

  // Type-safe props validation AFTER skipSSR is properly set
  if (!isValidGeneralPageInitialProps(mergedProps)) {
    throw new Error('Invalid merged props structure');
  }

  // Add user to seen users
  emitPageSeenEvent(context, mergedProps.pageWithMeta?.data?._id);

  // Persist activity
  addActivity(
    context,
    getActivityAction(
      mergedProps.isIdenticalPathPage,
      mergedProps.pageWithMeta,
    ),
  );

  return mergedResult;
}

export async function getServerSidePropsForSameRoute(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2EachProps>> {
  const [i18nPropsResult, pageDataForSameRouteResult] = await Promise.all([
    getServerSideI18nProps(context, ['translation']),
    getPageDataForSameRoute(context),
  ]);

  const { props: pageDataProps, internalProps } = pageDataForSameRouteResult;

  // Add user to seen users
  emitPageSeenEvent(
    context,
    internalProps?.pageWithMeta?.data?._id?.toString(),
  );

  // Persist activity
  addActivity(
    context,
    getActivityAction(
      pageDataProps.isIdenticalPathPage,
      internalProps?.pageWithMeta,
    ),
  );

  const mergedResult = mergeGetServerSidePropsResults(
    { props: pageDataProps },
    i18nPropsResult,
  );

  return mergedResult;
}
