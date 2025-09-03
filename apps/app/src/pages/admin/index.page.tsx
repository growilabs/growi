import { useHydrateAtoms } from 'jotai/utils';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import {
  growiCloudUriAtom,
  growiAppIdForGrowiCloudAtom,
} from '~/states/global';

import type { NextPageWithLayout } from '../_app.page';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

import type { AdminCommonProps } from './_shared';
import { createAdminPageLayout, getServerSideAdminCommonProps } from './_shared';

const AdminHome = dynamic(() => import('~/client/components/Admin/AdminHome/AdminHome'), { ssr: false });

type ExtraProps = {
  growiCloudUri?: string,
  growiAppIdForGrowiCloud?: number,
};
type Props = AdminCommonProps & ExtraProps;

// eslint-disable-next-line react/prop-types
const AdminHomepage: NextPageWithLayout<Props> = ({ growiCloudUri, growiAppIdForGrowiCloud }) => {
  // Hydrate atoms with fragment values (idempotent if already set by common props)
  useHydrateAtoms([
    [growiCloudUriAtom, growiCloudUri],
    [growiAppIdForGrowiCloudAtom, growiAppIdForGrowiCloud],
  ], { dangerouslyForceHydrate: true });

  return <AdminHome />;
};

AdminHomepage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('wiki_management_homepage'),
  containerFactories: [
    async() => {
      const AdminHomeContainer = (await import('~/client/services/AdminHomeContainer')).default;
      return new AdminHomeContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> = async(context: GetServerSidePropsContext) => {
  const baseResult = await getServerSideAdminCommonProps(context);
  if ('redirect' in baseResult || 'notFound' in baseResult) return baseResult;

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const fragment = {
    props: {
      growiCloudUri: crowi.configManager.getConfig('app:growiCloudUri'),
      growiAppIdForGrowiCloud: crowi.configManager.getConfig('app:growiAppIdForCloud'),
    },
  } satisfies { props: ExtraProps };
  return mergeGetServerSidePropsResults(baseResult, fragment);
};

export default AdminHomepage;
