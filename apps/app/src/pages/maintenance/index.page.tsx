import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

const Maintenance = dynamic(
  () =>
    import('~/client/components/Maintenance').then((mod) => mod.Maintenance),
  { ssr: false },
);

type Props = CommonInitialProps & CommonEachProps;

const MaintenancePage: NextPage<Props> = (props: Props) => {
  return (
    <div className="container-lg">
      <div className="container">
        <div className="row justify-content-md-center">
          <div className="col-md-6 mt-5">
            <Maintenance />
          </div>
        </div>
      </div>
    </div>
  );
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

  //
  // STAGE 2
  //
  const [commonInitialResult, i18nPropsResult] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideI18nProps(context, ['translation']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(commonEachPropsResult, i18nPropsResult),
  );
};

export default MaintenancePage;
