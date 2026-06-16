import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { GetServerSideI18nPropsOption } from '~/pages/common-props/i18n';

import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../common-props';
import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import type { AdminCommonProps } from './types';

/**
 * Build common admin SSR props (merges common initial/each/i18n and computes admin flag).
 * Returns redirect / notFound as-is.
 */
export const getServerSideAdminCommonProps = async (
  context: GetServerSidePropsContext,
  options?: GetServerSideI18nPropsOption,
): ReturnType<GetServerSideProps<AdminCommonProps>> => {
  //
  // STAGE 1
  //

  const commonEachPropsResult = await getServerSideCommonEachProps(context);
  // Handle early return cases (redirect/notFound)
  if (
    'redirect' in commonEachPropsResult ||
    'notFound' in commonEachPropsResult
  ) {
    return commonEachPropsResult;
  }
  const commonEachProps = await commonEachPropsResult.props;
  const { currentUser } = commonEachProps;

  const isAccessDeniedForNonAdminUser =
    currentUser == null || !currentUser.admin;

  //
  // STAGE 2
  //
  const [commonInitialResult, i18nResult] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideI18nProps(context, ['admin'], options),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachPropsResult,
      mergeGetServerSidePropsResults(i18nResult, {
        props: { isAccessDeniedForNonAdminUser },
      }),
    ),
  );
};
