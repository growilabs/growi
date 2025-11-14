import type { IPagePopulatedToShowRevision } from '@growi/core/dist/interfaces';

import type { IShareLinkHasId } from '~/interfaces/share-link';
import type { CommonEachProps, CommonInitialProps } from '~/pages/common-props';
import type { GeneralPageInitialProps } from '~/pages/general-page';

export type ShareLinkPageStatesProps = Pick<
  GeneralPageInitialProps,
  'skipSSR'
> &
  (
    | {
        page: null;
        isNotFound: true;
        isExpired: undefined;
        shareLink: undefined;
      }
    | {
        page: null;
        isNotFound: false;
        isExpired: true;
        shareLink: IShareLinkHasId;
      }
    | {
        page: IPagePopulatedToShowRevision;
        isNotFound: false;
        isExpired: false;
        shareLink: IShareLinkHasId;
      }
  );

export type Stage2EachProps = ShareLinkPageStatesProps;
export type Stage2InitialProps = Stage2EachProps &
  Omit<GeneralPageInitialProps, 'pageWithMeta'>;

export type EachProps = CommonEachProps & Stage2EachProps;
export type InitialProps = CommonEachProps &
  CommonInitialProps &
  Stage2InitialProps;
