import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import { useTranslation } from 'next-i18next';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import type { BasicLayoutConfigurationProps } from '~/pages/basic-layout-page';
import { getServerSideBasicLayoutProps } from '~/pages/basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '~/pages/basic-layout-page/hydrate';
import { useCustomTitle } from '~/pages/utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props';

import type { NextPageWithLayout } from '../../_app.page';
import type { CommonEachProps, CommonInitialProps } from '../../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../../common-props';

const ChangeProposalDetail = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/change-proposal/client/viewer').then(
      (m) => m.ChangeProposalDetail,
    ),
  { ssr: false },
);

type Props = CommonInitialProps &
  CommonEachProps &
  BasicLayoutConfigurationProps;

const ChangeProposalDetailPage: NextPageWithLayout<Props> = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const title = useCustomTitle(t('change_proposal_viewer.list.title'));

  const { id } = router.query;
  const proposalId = typeof id === 'string' && isValidObjectId(id) ? id : null;

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root">
        <GroundGlassBar className="sticky-top py-4"></GroundGlassBar>

        <div className="main ps-sidebar">
          <div className="container-lg wide-gutter-x-lg">
            {proposalId != null ? (
              <ChangeProposalDetail proposalId={proposalId} />
            ) : (
              <div className="alert alert-secondary">
                {t('change_proposal_viewer.detail.not_found')}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

type LayoutProps = Props & {
  children?: ReactNode;
};

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  useHydrateBasicLayoutConfigurationAtoms(
    props.searchConfig,
    props.sidebarConfig,
    props.userUISettings,
  );

  return <BasicLayout>{children}</BasicLayout>;
};

ChangeProposalDetailPage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const [
    commonInitialResult,
    commonEachResult,
    basicLayoutResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideI18nProps(context, ['translation', 'commons']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(basicLayoutResult, i18nPropsResult),
    ),
  );
};

export default ChangeProposalDetailPage;
