import type { GetServerSidePropsContext } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { CommonProps } from '~/pages/utils/commons';
import {
  getNextI18NextConfig,
  getServerSideCommonProps,
} from '~/pages/utils/commons';

/**
 * for Server Side Translations
 * @param context
 * @param props
 * @param namespacesRequired
 */
async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  // preload all languages because of language lists in user setting
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
    true,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

export const retrieveServerSideProps: any = async (
  context: GetServerSidePropsContext,
  injectServerConfigurations?: (
    context: GetServerSidePropsContext,
    props,
  ) => Promise<void>,
) => {
  const req = context.req as CrowiRequest;
  const { user } = req;

  const result = await getServerSideCommonProps(context);

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: CommonProps = result.props as CommonProps;
  if (injectServerConfigurations != null) {
    await injectServerConfigurations(context, props);
  }

  if (user != null) {
    props.currentUser = user.toObject();
  }

  props.isAccessDeniedForNonAdminUser =
    props.currentUser == null ? true : !props.currentUser.admin;

  await injectNextI18NextConfigurations(context, props, ['admin', 'commons']);

  return {
    props,
  };
};
