import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

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

  // -- TODO: persist activity
  // await addActivity(context, getActivityAction(mergedProps));
  return mergedResult;
}

export async function getServerSidePropsForSameRoute(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2EachProps>> {
  // Get page data
  const result = await getPageDataForSameRoute(context);

  // -- TODO: persist activity

  // const mergedProps = await mergedResult.props;
  // await addActivity(context, getActivityAction(mergedProps));
  return result;
}
