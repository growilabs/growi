import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

import {
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../common-props';
import {
  getActivityAction,
  getServerSideGeneralPageProps,
  getServerSideRendererConfigProps,
  isValidGeneralPageInitialProps,
} from '../../general-page';
import { addActivity } from '../../utils/activity';
import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import { getPageDataForInitial } from './page-data-props';
import type { Stage2InitialProps } from './types';

const basisProps = {
  props: {
    isNotCreatable: true,
    isForbidden: false,
    isIdenticalPathPage: false,
  },
};

export async function getServerSidePropsForInitial(
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Stage2InitialProps>> {
  const [
    commonInitialResult,
    generalPageResult,
    rendererConfigResult,
    i18nPropsResult,
    pageDataResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideGeneralPageProps(context),
    getServerSideRendererConfigProps(context),
    getServerSideI18nProps(context, ['translation']),
    getPageDataForInitial(context),
  ]);

  // Merge all results in a type-safe manner (using sequential merging)
  const mergedResult = mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      generalPageResult,
      mergeGetServerSidePropsResults(
        rendererConfigResult,
        mergeGetServerSidePropsResults(
          i18nPropsResult,
          mergeGetServerSidePropsResults(pageDataResult, basisProps),
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

  await addActivity(context, getActivityAction(mergedProps));
  return mergedResult;
}
