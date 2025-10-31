import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { RawLayout } from '~/components/Layout/RawLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import { useIsMailerSetup } from '~/stores-universal/context';

import type { CommonProps } from './utils/commons';
import {
  getNextI18NextConfig,
  getServerSideCommonProps,
} from './utils/commons';

const PasswordResetRequestForm = dynamic(
  () => import('~/client/components/PasswordResetRequestForm'),
  { ssr: false },
);

type Props = CommonProps & {
  isMailerSetup: boolean;
};

const ForgotPasswordPage: NextPage<Props> = (props: Props) => {
  useIsMailerSetup(props.isMailerSetup);

  return (
    <RawLayout>
      <div className="main">
        <div className="container-lg">
          <div className="container">
            <div className="row justify-content-md-center">
              <div className="col-md-6 mt-5">
                <div className="text-center">
                  <PasswordResetRequestForm />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RawLayout>
  );
};

// eslint-disable-next-line max-len
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

const injectServerConfigurations = async (
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { mailService } = crowi;

  props.isMailerSetup = mailService.isMailerSetup;
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const result = await getServerSideCommonProps(context);

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, [
    'translation',
    'commons',
  ]);

  return {
    props,
  };
};

export default ForgotPasswordPage;
