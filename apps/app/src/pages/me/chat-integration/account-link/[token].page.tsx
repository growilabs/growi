import React, { type JSX } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';

import { RawLayout } from '~/components/Layout/RawLayout';
import { useCustomTitle } from '~/pages/utils/page-title-customization';

import type { NextPageWithLayout } from '../../../_app.page';
import type {
  CommonEachProps,
  CommonInitialProps,
} from '../../../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../../common-props';
import { mergeGetServerSidePropsResults } from '../../../utils/server-side-props';

const AccountLinkApproval = dynamic(
  () =>
    import(
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      '~/features/chat-integration/client/components/AccountLinkApproval'
    ).then((mod) => mod.AccountLinkApproval),
  { ssr: false },
);

type Props = CommonInitialProps & CommonEachProps;

// A dedicated page, not an entry of `me/[[...path]]`: the approval screen
// must not carry the sidebar or navigation, and a catch-all page has a
// single layout. Login is enforced by the Express `/me/*` route.
const AccountLinkApprovalPage: NextPageWithLayout<Props> = (): JSX.Element => {
  const { t } = useTranslation();
  const title = useCustomTitle(t('chat_integration.account_link.page_title'));

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <AccountLinkApproval />
    </>
  );
};

AccountLinkApprovalPage.getLayout = function getLayout(page) {
  return <RawLayout>{page}</RawLayout>;
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const [commonInitialResult, commonEachResult, i18nPropsResult] =
    await Promise.all([
      getServerSideCommonInitialProps(context),
      getServerSideCommonEachProps(context),
      getServerSideI18nProps(context, ['translation', 'commons']),
    ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(commonEachResult, i18nPropsResult),
  );
};

export default AccountLinkApprovalPage;
