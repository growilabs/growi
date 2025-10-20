import type { JSX, ReactNode } from 'react';
import React, { useCallback, useState } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {
  isPermalink,
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { IDataTagCount } from '~/interfaces/tag';
import { useSWRxTagsList } from '~/stores/tag';

import type { NextPageWithLayout } from '../_app.page';
import type { BasicLayoutConfigurationProps } from '../basic-layout-page';
import { getServerSideBasicLayoutProps } from '../basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate';
import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

const PAGING_LIMIT = 10;

const TagList = dynamic(() => import('~/client/components/TagList'), {
  ssr: false,
});
const TagCloudBox = dynamic(() => import('~/client/components/TagCloudBox'), {
  ssr: false,
});

type Props = CommonInitialProps &
  CommonEachProps &
  BasicLayoutConfigurationProps;

const TagPage: NextPageWithLayout<Props> = (props: Props) => {
  const { t } = useTranslation();

  // // clear the cache for the current page
  // //  in order to fix https://redmine.weseek.co.jp/issues/135811
  // useHydratePageAtoms(undefined);
  // useCurrentPathname('/tags');

  const [activePage, setActivePage] = useState<number>(1);
  const [offset, setOffset] = useState<number>(0);

  const { data: tagDataList, error } = useSWRxTagsList(PAGING_LIMIT, offset);
  const setOffsetByPageNumber = useCallback((selectedPageNumber: number) => {
    setActivePage(selectedPageNumber);
    setOffset((selectedPageNumber - 1) * PAGING_LIMIT);
  }, []);

  const tagData: IDataTagCount[] = tagDataList?.data || [];
  const totalCount: number = tagDataList?.totalCount || 0;
  const isLoading = tagDataList === undefined && error == null;

  const title = useCustomTitle(t('Tags'));

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root">
        <GroundGlassBar className="sticky-top py-4"></GroundGlassBar>

        <div className="main ps-sidebar" data-testid="tags-page">
          <div className="container-lg wide-gutter-x-lg">
            <h2 className="sticky-top py-1">{`${t('Tags')}(${totalCount})`}</h2>

            <div className="px-3 mb-5 text-center">
              <TagCloudBox tags={tagData} minSize={20} />
            </div>
            {isLoading ? (
              <div className="text-muted text-center">
                <LoadingSpinner className="mt-3 fs-3" />
              </div>
            ) : (
              <div data-testid="grw-tags-list">
                <TagList
                  tagData={tagData}
                  totalTags={totalCount}
                  activePage={activePage}
                  onChangePage={setOffsetByPageNumber}
                  pagingLimit={PAGING_LIMIT}
                />
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

TagPage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req: CrowiRequest = context.req as CrowiRequest;

  // redirect to the page the user was on before moving to the Login Page
  if (req.headers.referer != null) {
    const urlBeforeLogin = new URL(req.headers.referer);
    if (
      isPermalink(urlBeforeLogin.pathname) ||
      isUserPage(urlBeforeLogin.pathname) ||
      isUsersTopPage(urlBeforeLogin.pathname)
    ) {
      req.session.redirectTo = urlBeforeLogin.href;
    }
  }

  const [
    commonInitialResult,
    commonEachResult,
    basicLayoutResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideI18nProps(context, ['translation']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(basicLayoutResult, i18nPropsResult),
    ),
  );
};

export default TagPage;
