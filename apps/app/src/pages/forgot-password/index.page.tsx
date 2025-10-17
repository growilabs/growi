import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';

import { RawLayout } from '~/components/Layout/RawLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { ServerConfigurationProps } from './types';
import { useHydrateServerConfigurationAtoms } from './use-hydrate-server-configurations';

const PasswordResetRequestForm = dynamic(
  () => import('~/client/components/PasswordResetRequestForm'),
  { ssr: false },
);

type Props = CommonInitialProps & CommonEachProps & ServerConfigurationProps;

const ForgotPasswordPage: NextPage<Props> = (props: Props) => {
  useHydrateServerConfigurationAtoms(props.serverConfig);

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

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { mailService } = crowi;

  return {
    props: {
      serverConfig: {
        isMailerSetup: mailService.isMailerSetup,
      },
    },
  };
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const [
    commonInitialResult,
    commonEachResult,
    serverConfigResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideConfigurationProps(context),
    getServerSideI18nProps(context, ['translation', 'commons']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
    ),
  );
};

export default ForgotPasswordPage;
