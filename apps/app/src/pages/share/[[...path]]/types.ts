import type { IShareLinkHasId } from '~/interfaces/share-link';
import type { CommonEachProps, CommonInitialProps } from '~/pages/common-props';
import type { GeneralPageInitialProps } from '~/pages/general-page';

export type ShareLinkPageStatesProps = Pick<GeneralPageInitialProps, 'pageWithMeta' | 'skipSSR'> & (
  {
    isNotFound: true,
    isExpired: undefined,
    shareLink: undefined,
  } | {
    isNotFound: false,
    isExpired: true,
    shareLink: IShareLinkHasId,
  } | {
    isNotFound: false,
    isExpired: false,
    shareLink: IShareLinkHasId,
  }
);

export type Stage2EachProps = ShareLinkPageStatesProps;
export type Stage2InitialProps = Stage2EachProps & GeneralPageInitialProps;

export type EachProps = CommonEachProps & Stage2EachProps;
export type InitialProps = CommonEachProps & CommonInitialProps & Stage2InitialProps;
