export {
  getServerSideGeneralPageProps,
  getServerSideRendererConfigProps,
  getServerSideShareLinkRendererConfigProps,
} from '~/pages/general-page/configuration-props';
export { isValidGeneralPageInitialProps } from '~/pages/general-page/type-guards';
export { useInitialCSRFetch } from '~/pages/general-page/use-initial-csr-fetch';

export type * from './types';
