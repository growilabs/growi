import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import type { IUser } from '@growi/core';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { useCurrentUser } from '~/stores-universal/context';

import type { CommonProps } from './utils/commons';
import {
  getNextI18NextConfig,
  getServerSideCommonProps,
} from './utils/commons';

const Maintenance = dynamic(
  () =>
    import('~/client/components/Maintenance').then((mod) => mod.Maintenance),
  { ssr: false },
);

type Props = CommonProps & {
  currentUser: IUser;
};

const MaintenancePage: NextPage<CommonProps> = (props: Props) => {
  useCurrentUser(props.currentUser ?? null);

  return (
    <div className="container-lg">
      <div className="container">
        <div className="row justify-content-md-center">
          <div className="col-md-6 mt-5">
            <Maintenance currentUser={props.currentUser} />
          </div>
        </div>
      </div>
    </div>
  );
};

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

  const result = await getServerSideCommonProps(context);

  if ('redirect' in result) {
    return { redirect: result.redirect };
  }

  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  if (props.redirectDestination != null) {
    return {
      redirect: {
        permanent: false,
        destination: props.redirectDestination,
      },
    };
  }

  const { user } = req;
  if (user != null) {
    props.currentUser = user.toObject();
  }

  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default MaintenancePage;
