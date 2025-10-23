import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { IUser } from '@growi/core';
import { USER_STATUS } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import {
  useCsrfToken,
  useCurrentPathname,
  useCurrentUser,
} from '~/stores-universal/context';

import type { CommonProps } from './utils/commons';
import {
  generateCustomTitle,
  getNextI18NextConfig,
  getServerSideCommonProps,
} from './utils/commons';

const InvitedForm = dynamic(
  () =>
    import('~/client/components/InvitedForm').then((mod) => mod.InvitedForm),
  { ssr: false },
);

type Props = CommonProps & {
  currentUser: IUser;
  invitedFormUsername: string;
  invitedFormName: string;
};

const InvitedPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  useCsrfToken(props.csrfToken);
  useCurrentPathname(props.currentPathname);
  useCurrentUser(props.currentUser);

  const title = generateCustomTitle(props, t('invited.title'));
  const classNames: string[] = ['invited-page'];

  return (
    <NoLoginLayout className={classNames.join(' ')}>
      <Head>
        <title>{title}</title>
      </Head>
      <InvitedForm
        invitedFormUsername={props.invitedFormUsername}
        invitedFormName={props.invitedFormName}
      />
    </NoLoginLayout>
  );
};

async function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { body: invitedForm } = req;

  if (props.invitedFormUsername != null) {
    props.invitedFormUsername = invitedForm.username;
  }
  if (props.invitedFormName != null) {
    props.invitedFormName = invitedForm.name;
  }
}

/**
 * for Server Side Translations
 * @param context
 * @param props
 * @param namespacesRequired
 */
async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req = context.req as CrowiRequest;
  const { user } = req;
  const result = await getServerSideCommonProps(context);

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }
  const props: Props = result.props as Props;

  if (user != null) {
    props.currentUser = user.toObject();

    // Only invited user can access to /invited page
    if (props.currentUser.status !== USER_STATUS.INVITED) {
      return {
        redirect: {
          permanent: false,
          destination: '/',
        },
      };
    }
  }

  await injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, ['translation']);

  return { props };
};

export default InvitedPage;
