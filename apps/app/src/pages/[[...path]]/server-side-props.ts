import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getServerSideBasicLayoutProps } from '../basic-layout-page';
import {
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import {
  getActivityAction,
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

  const pageEvent = crowi.event('page');
  pageEvent.emit('seen', pageId, user);
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

  // -- TODO: persist activity
  // await addActivity(context, getActivityAction(mergedProps));
  return mergedResult;
}

export async function getServerSidePropsForSameRoute(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2EachProps>> {
  // -- TODO: ：https://redmine.weseek.co.jp/issues/174725
  // Remove getServerSideI18nProps from getServerSidePropsForSameRoute for performance improvement
  const [i18nPropsResult, pageDataForSameRouteResult] = await Promise.all([
    getServerSideI18nProps(context, ['translation']),
    getPageDataForSameRoute(context),
  ]);

  const { props: pageDataProps, internalProps } = pageDataForSameRouteResult;

  // Add user to seen users
  emitPageSeenEvent(context, internalProps?.pageId);

  // -- TODO: persist activity
  // const mergedProps = await mergedResult.props;
  // await addActivity(context, getActivityAction(mergedProps));
  const mergedResult = mergeGetServerSidePropsResults(
    { props: pageDataProps },
    i18nPropsResult,
  );

  return mergedResult;
}
