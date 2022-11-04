import { NextPage, GetServerSideProps, GetServerSidePropsContext } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import CompleteUserRegistrationForm from '~/components/CompleteUserRegistrationForm';
import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { UserActivationErrorCode } from '~/interfaces/errors/user-activation';
import { IUserRegistrationOrder } from '~/server/models/user-registration-order';

import {
  getServerSideCommonProps, getNextI18NextConfig, useCustomTitle, CommonProps,
} from './utils/commons';

type Props = CommonProps & {
  token: string
  email: string
  errorCode?: UserActivationErrorCode
  isEmailAuthenticationEnabled: boolean
}

const UserActivationPage: NextPage<Props> = (props: Props) => {
  return (
    <NoLoginLayout title={useCustomTitle(props, 'GROWI')}>
      <CompleteUserRegistrationForm
        token={props.token}
        email={props.email}
        errorCode={props.errorCode}
        isEmailAuthenticationEnabled={props.isEmailAuthenticationEnabled}
      />
    </NoLoginLayout>
  );
};

/**
 * for Server Side Translations
 * @param context
 * @param props
 * @param namespacesRequired
 */
async function injectNextI18NextConfigurations(context: GetServerSidePropsContext, props: Props, namespacesRequired?: string[] | undefined): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(serverSideTranslations, context, namespacesRequired);
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const result = await getServerSideCommonProps(context);
  const req: CrowiRequest = context.req as CrowiRequest;

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  if (context.query.userRegistrationOrder != null) {
    const userRegistrationOrder = context.query.userRegistrationOrder as unknown as IUserRegistrationOrder;
    props.email = userRegistrationOrder.email;
    props.token = userRegistrationOrder.token;
  }

  if (typeof context.query.errorCode === 'string') {
    props.errorCode = context.query.errorCode as UserActivationErrorCode;
  }

  props.isEmailAuthenticationEnabled = req.crowi.configManager.getConfig('crowi', 'security:passport-local:isEmailAuthenticationEnabled');

  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default UserActivationPage;
