import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
import type { IShareLinkHasId } from '~/interfaces/share-link';

import {
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../common-props';
import {
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

  // Persist activity
  addActivity(context, getActivityAction(mergedProps));

  return mergedResult;
}
