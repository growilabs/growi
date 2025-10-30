import type { JSX, ReactNode } from 'react';
import React, { useCallback, useState } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { IUser } from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import type { IDataTagCount } from '~/interfaces/tag';
import { useCurrentPageId, useSWRxCurrentPage } from '~/stores/page';
import { useSWRxTagsList } from '~/stores/tag';
import {
  useCurrentPathname,
  useCurrentUser,
  useGrowiCloudUri,
  useIsSearchPage,
  useIsSearchScopeChildrenAsDefault,
  useIsSearchServiceConfigured,
  useIsSearchServiceReachable,
} from '~/stores-universal/context';

import type { NextPageWithLayout } from './_app.page';
import type { CommonProps } from './utils/commons';
import {
  generateCustomTitle,
  getNextI18NextConfig,
  getServerSideCommonProps,
  useInitSidebarConfig,
} from './utils/commons';

const PAGING_LIMIT = 10;

type Props = CommonProps & {
  currentUser: IUser;
  isSearchServiceConfigured: boolean;
  isSearchServiceReachable: boolean;
  isSearchScopeChildrenAsDefault: boolean;

  rendererConfig: RendererConfig;

  sidebarConfig: ISidebarConfig;
};

const TagList = dynamic(() => import('~/client/components/TagList'), {
  ssr: false,
});
const TagCloudBox = dynamic(() => import('~/client/components/TagCloudBox'), {
  ssr: false,
});

const TagPage: NextPageWithLayout<CommonProps> = (props: Props) => {
  const [activePage, setActivePage] = useState<number>(1);
  const [offset, setOffset] = useState<number>(0);

  useCurrentUser(props.currentUser ?? null);

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  useSWRxCurrentPage(null);
  useCurrentPageId(null);
  useCurrentPathname('/tags');

  const { data: tagDataList, error } = useSWRxTagsList(PAGING_LIMIT, offset);
  const { t } = useTranslation('');
  const setOffsetByPageNumber = useCallback((selectedPageNumber: number) => {
    setActivePage(selectedPageNumber);
    setOffset((selectedPageNumber - 1) * PAGING_LIMIT);
  }, []);

  const tagData: IDataTagCount[] = tagDataList?.data || [];
  const totalCount: number = tagDataList?.totalCount || 0;
  const isLoading = tagDataList === undefined && error == null;

  useGrowiCloudUri(props.growiCloudUri);

  useIsSearchPage(false);
  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);

  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  const title = generateCustomTitle(props, t('Tags'));

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
  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  return <BasicLayout>{children}</BasicLayout>;
};

TagPage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): void {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { searchService, configManager } = crowi;

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig(
    'customize:isSearchScopeChildrenAsDefault',
  );

  props.sidebarConfig = {
    isSidebarCollapsedMode: configManager.getConfig(
      'customize:isSidebarCollapsedMode',
    ),
    isSidebarClosedAtDockMode: configManager.getConfig(
      'customize:isSidebarClosedAtDockMode',
    ),
  };
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

  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }
  const props: Props = result.props as Props;

  if (user != null) {
    props.currentUser = user.toObject();
  }

  injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default TagPage;
