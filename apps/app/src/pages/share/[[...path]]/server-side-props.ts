import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
import type { IShareLinkHasId } from '~/interfaces/share-link';

import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../common-props';
import {
  getServerSideGeneralPageProps,
  getServerSideShareLinkRendererConfigProps,
  isValidGeneralPageInitialProps,
} from '../../general-page';
import { addActivity } from '../../utils/activity';
import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import { NEXT_JS_ROUTING_PAGE } from './consts';
import { getPageDataForInitial } from './page-data-props';
import type { Stage2EachProps, Stage2InitialProps } from './types';

const basisProps = {
  props: {
    isNotCreatable: true,
    isForbidden: false,
    isIdenticalPathPage: false,
  },
};

const nextjsRoutingProps = {
  props: {
    nextjsRoutingPage: NEXT_JS_ROUTING_PAGE,
  },
};

function getActivityAction(props: {
  isExpired: boolean | undefined;
  shareLink: IShareLinkHasId | undefined;
}): SupportedActionType {
  if (props.isExpired) {
    return SupportedAction.ACTION_SHARE_LINK_EXPIRED_PAGE_VIEW;
  }

  if (props.shareLink == null) {
    return SupportedAction.ACTION_SHARE_LINK_NOT_FOUND;
  }

  return SupportedAction.ACTION_SHARE_LINK_PAGE_VIEW;
}

export async function getServerSidePropsForInitial(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2InitialProps>> {
  const [
    commonEachResult,
    commonInitialResult,
    generalPageResult,
    rendererConfigResult,
    i18nPropsResult,
    pageDataResult,
  ] = await Promise.all([
    getServerSideCommonEachProps(context),
    getServerSideCommonInitialProps(context),
    getServerSideGeneralPageProps(context),
    getServerSideShareLinkRendererConfigProps(context),
    getServerSideI18nProps(context, ['translation']),
    getPageDataForInitial(context),
  ]);

  // Merge all results in a type-safe manner (using sequential merging)
  const mergedResult = mergeGetServerSidePropsResults(
    commonEachResult,
    mergeGetServerSidePropsResults(
      commonInitialResult,
      mergeGetServerSidePropsResults(
        generalPageResult,
        mergeGetServerSidePropsResults(
          rendererConfigResult,
          mergeGetServerSidePropsResults(
            i18nPropsResult,
            mergeGetServerSidePropsResults(
              pageDataResult,
              mergeGetServerSidePropsResults(basisProps, nextjsRoutingProps),
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

  // Persist activity
  addActivity(context, getActivityAction(mergedProps));

  return mergedResult;
}

export async function getServerSidePropsForSameRoute(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2EachProps>> {
  // Unlike [[...path]], the page cannot be fetched client-side from the URL alone:
  // the share link itself is resolved only on the server.
  const [i18nPropsResult, pageDataResult] = await Promise.all([
    getServerSideI18nProps(context, ['translation']),
    getPageDataForInitial(context),
  ]);

  const mergedResult: GetServerSidePropsResult<Stage2EachProps> =
    mergeGetServerSidePropsResults(pageDataResult, i18nPropsResult);

  // Check for early return (redirect/notFound)
  if ('redirect' in mergedResult || 'notFound' in mergedResult) {
    return mergedResult;
  }

  const mergedProps = await mergedResult.props;

  // Persist activity
  addActivity(context, getActivityAction(mergedProps));

  return mergedResult;
}
