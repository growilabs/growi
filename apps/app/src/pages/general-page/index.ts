export {
  getServerSideGeneralPageProps,
  getServerSideRendererConfigProps,
  getServerSideShareLinkRendererConfigProps,
} from '~/pages/general-page/configuration-props.js';
export { isValidGeneralPageInitialProps } from '~/pages/general-page/type-guards.js';
export type * from './types.js';
export { useInitialCSRFetch } from '~/pages/general-page/use-initial-csr-fetch.js';
