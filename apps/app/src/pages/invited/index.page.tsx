import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { USER_STATUS } from '@growi/core';
import { useTranslation } from 'next-i18next';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

const InvitedForm = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/InvitedForm').then((mod) => mod.InvitedForm),
  { ssr: false },
);

type ServerConfigurationProps = {
  invitedFormUsername: string;
  invitedFormName: string;
};

type Props = CommonInitialProps & CommonEachProps & ServerConfigurationProps;

const InvitedPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  const title = useCustomTitle(t('invited.title'));
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

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req = context.req as CrowiRequest;
  const { body: invitedForm } = req;

  return {
    props: {
      invitedFormUsername: invitedForm?.username ?? '',
      invitedFormName: invitedForm?.name ?? '',
    },
  };
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
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

  // Handle redirect destination from common props
  if (commonEachProps.redirectDestination != null) {
    return {
      redirect: {
        permanent: false,
        destination: commonEachProps.redirectDestination,
      },
    };
  }

  // Only invited user can access to /invited page
  if (
    commonEachProps.currentUser != null &&
    commonEachProps.currentUser.status !== USER_STATUS.INVITED
  ) {
    return {
      redirect: {
        permanent: false,
        destination: '/',
      },
    };
  }

  //
  // STAGE 2
  //
  const [commonInitialResult, serverConfigResult, i18nPropsResult] =
    await Promise.all([
      getServerSideCommonInitialProps(context),
      getServerSideConfigurationProps(context),
      getServerSideI18nProps(context, ['translation']),
    ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachPropsResult,
      mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
    ),
  );
};

export default InvitedPage;
