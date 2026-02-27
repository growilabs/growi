import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import { isIPageNotFoundInfo } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getServerSideBasicLayoutProps } from '../basic-layout-page';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import {
  getServerSideGeneralPageProps,
  getServerSideRendererConfigProps,
} from '../general-page';
import { isValidGeneralPageInitialProps } from '../general-page/type-guards';
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

  const pageEvent = crowi.events.page;
  pageEvent.emit('seen', pageId, user);
}

function getActivityAction(params: {
  isIdenticalPathPage: boolean;
  isForbidden?: boolean;
  isNotFound?: boolean;
  path?: string;
}): SupportedActionType {
  if (params.isIdenticalPathPage) {
    return SupportedAction.ACTION_PAGE_NOT_CREATABLE;
  }

  if (params.isForbidden) {
    return SupportedAction.ACTION_PAGE_FORBIDDEN;
  }

  if (params.isNotFound) {
    return SupportedAction.ACTION_PAGE_NOT_FOUND;
  }

  if (params.path != null && pagePathUtils.isUsersHomepage(params.path)) {
    return SupportedAction.ACTION_PAGE_USER_HOME_VIEW;
  }

  return SupportedAction.ACTION_PAGE_VIEW;
}

export async function getServerSidePropsForInitial(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2InitialProps>> {
  const [
    commonEachResult,
    commonInitialResult,
    basicLayoutResult,
    generalPageResult,
    rendererConfigResult,
    i18nPropsResult,
    pageDataResult,
  ] = await Promise.all([
    getServerSideCommonEachProps(context),
    getServerSideCommonInitialProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideGeneralPageProps(context),
    getServerSideRendererConfigProps(context),
    getServerSideI18nProps(context, ['translation']),
    getPageDataForInitial(context),
  ]);

  // Merge all results in a type-safe manner (using sequential merging)
  const mergedResult: GetServerSidePropsResult<Stage2InitialProps> =
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(
        commonInitialResult,
        mergeGetServerSidePropsResults(
          basicLayoutResult,
          mergeGetServerSidePropsResults(
            generalPageResult,
            mergeGetServerSidePropsResults(
              rendererConfigResult,
              mergeGetServerSidePropsResults(
                i18nPropsResult,
                mergeGetServerSidePropsResults(
                  pageDataResult,
                  nextjsRoutingProps,
                ),
              ),
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
  const activityAction = (() => {
    const meta = mergedProps.pageWithMeta?.meta;
    if (isIPageNotFoundInfo(meta)) {
      return getActivityAction({
        isIdenticalPathPage: mergedProps.isIdenticalPathPage,
        isForbidden: meta.isForbidden,
        isNotFound: meta.isNotFound,
      });
    }
    return getActivityAction({
      isIdenticalPathPage: mergedProps.isIdenticalPathPage,
      path: mergedProps.pageWithMeta?.data?.path,
    });
  })();
  addActivity(context, activityAction);

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
  const activityAction = (() => {
    const meta = internalProps?.pageWithMeta?.meta;
    if (isIPageNotFoundInfo(meta)) {
      return getActivityAction({
        isIdenticalPathPage: pageDataProps.isIdenticalPathPage,
        isForbidden: meta.isForbidden,
        isNotFound: meta.isNotFound,
      });
    }
    return getActivityAction({
      isIdenticalPathPage: pageDataProps.isIdenticalPathPage,
      path: internalProps?.pageWithMeta?.data?.path,
    });
  })();
  addActivity(context, activityAction);

  const mergedResult: GetServerSidePropsResult<Stage2EachProps> =
    mergeGetServerSidePropsResults({ props: pageDataProps }, i18nPropsResult);

  return mergedResult;
}
